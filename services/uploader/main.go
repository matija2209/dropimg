package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/google/uuid"
)

const (
	pipelineName          = "videos"
	callbackPipeline      = "dropimg-videos"
	defaultMaxVideoUpload = 500
	sessionExpiry         = 24 * time.Hour
)

type session struct {
	ID            string
	FileName      string
	MimeType      string
	FileSize      int64
	UploadedBytes int64
	CreatedAt     time.Time
	UploadID      string
	S3Key         string
	Parts         []types.CompletedPart
	Digest        hash.Hash
	ObjectReady   bool
	Fingerprint   string
	mu            sync.Mutex
}

type app struct {
	s3              *s3.Client
	bucket          string
	apiInternalURL  string
	internalSecret  string
	httpClient      *http.Client
	sessions        map[string]*session
	sessionsMu      sync.RWMutex
}

type initRequest struct {
	SessionID *string `json:"sessionId"`
	FileName  string  `json:"fileName"`
	MimeType  string  `json:"mimeType"`
	FileSize  int64   `json:"fileSize"`
}

type completeRequest struct {
	SessionID string  `json:"sessionId"`
	AltName   *string `json:"altName,omitempty"`
	Transcode *bool   `json:"transcode,omitempty"`
	UserID    *string `json:"userId,omitempty"`
}

type stagedUploadPayload struct {
	S3Key       string `json:"s3Key"`
	FileName    string `json:"fileName"`
	MimeType    string `json:"mimeType"`
	FileSize    int64  `json:"fileSize"`
	Fingerprint string `json:"fingerprint"`
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	application, err := newApp(ctx)
	if err != nil {
		log.Fatalf("init uploader: %v", err)
	}

	go application.cleanupExpiredSessions(ctx)

	server := &http.Server{
		Addr:              ":8080",
		Handler:           application.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer shutdownCancel()
		application.abortInflightMultipartUploads(shutdownCtx)
		_ = server.Shutdown(shutdownCtx)
	}()

	log.Printf("dropimg uploader listening on %s", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("uploader listen: %v", err)
	}
}

func newApp(ctx context.Context) (*app, error) {
	cfg, err := awsconfig.LoadDefaultConfig(
		ctx,
		awsconfig.WithRegion(envOrDefault("S3_REGION", "garage")),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			os.Getenv("S3_ACCESS_KEY_ID"),
			os.Getenv("S3_SECRET_ACCESS_KEY"),
			"",
		)),
	)
	if err != nil {
		return nil, err
	}

	endpoint := strings.TrimSpace(os.Getenv("S3_ENDPOINT"))
	if endpoint == "" {
		return nil, errors.New("S3_ENDPOINT is required")
	}
	bucket := strings.TrimSpace(os.Getenv("S3_BUCKET"))
	if bucket == "" {
		return nil, errors.New("S3_BUCKET is required")
	}

	apiURL := strings.TrimRight(strings.TrimSpace(os.Getenv("API_INTERNAL_URL")), "/")
	if apiURL == "" {
		apiURL = strings.TrimRight(strings.TrimSpace(os.Getenv("NEXTJS_INTERNAL_URL")), "/")
	}
	if apiURL == "" {
		return nil, errors.New("API_INTERNAL_URL is required")
	}

	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = true
	})

	return &app{
		s3:             s3Client,
		bucket:         bucket,
		apiInternalURL: apiURL,
		internalSecret: strings.TrimSpace(os.Getenv("INTERNAL_UPLOAD_SECRET")),
		httpClient:     &http.Client{Timeout: 600 * time.Second},
		sessions:       make(map[string]*session),
	}, nil
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	mux.HandleFunc("/", a.handle)
	return mux
}

func (a *app) handle(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/api/upload/chunked") {
		http.NotFound(w, r)
		return
	}
	switch {
	case strings.HasSuffix(r.URL.Path, "/chunked/init"):
		a.handleInit(w, r)
	case strings.HasSuffix(r.URL.Path, "/chunked/complete"):
		a.handleComplete(w, r)
	case strings.Contains(r.URL.Path, "/chunked/"):
		a.handleSessionRoute(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (a *app) handleInit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	var body initRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "Invalid init request."})
		return
	}
	if body.FileName == "" || body.MimeType == "" || body.FileSize <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "Invalid init request."})
		return
	}

	mimeType := canonicalMime(body.MimeType)
	if !strings.HasPrefix(mimeType, "video/") {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "Only video uploads are allowed on this endpoint."})
		return
	}

	maxBytes := int64(envInt("MAX_VIDEO_UPLOAD_MB", defaultMaxVideoUpload)) * 1024 * 1024
	if body.FileSize > maxBytes {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"ok":      false,
			"message": fmt.Sprintf("File exceeds maximum size (%d MB).", envInt("MAX_VIDEO_UPLOAD_MB", defaultMaxVideoUpload)),
		})
		return
	}

	if body.SessionID != nil {
		if existing := a.getSession(*body.SessionID); existing != nil {
			existing.mu.Lock()
			defer existing.mu.Unlock()
			if existing.FileName == body.FileName && existing.MimeType == mimeType && existing.FileSize == body.FileSize {
				writeJSON(w, http.StatusOK, map[string]any{
					"ok": true, "sessionId": existing.ID, "uploadedBytes": existing.UploadedBytes, "fileSize": existing.FileSize,
				})
				return
			}
		}
	}

	sessionID := uuid.NewString()
	s3Key := fmt.Sprintf("chunked-staging/%s/%s/%s", pipelineName, sessionID, body.FileName)
	createOut, err := a.s3.CreateMultipartUpload(r.Context(), &s3.CreateMultipartUploadInput{
		Bucket: aws.String(a.bucket), Key: aws.String(s3Key), ContentType: aws.String(mimeType),
	})
	if err != nil {
		log.Printf("create multipart: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "Failed to start upload."})
		return
	}

	s := &session{
		ID: sessionID, FileName: body.FileName, MimeType: mimeType, FileSize: body.FileSize,
		CreatedAt: time.Now().UTC(), UploadID: aws.ToString(createOut.UploadId), S3Key: s3Key,
		Parts: make([]types.CompletedPart, 0, 16), Digest: sha256.New(),
	}
	a.sessionsMu.Lock()
	a.sessions[sessionID] = s
	a.sessionsMu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "sessionId": s.ID, "uploadedBytes": s.UploadedBytes, "fileSize": s.FileSize,
	})
}

func (a *app) handleSessionRoute(w http.ResponseWriter, r *http.Request) {
	sessionID := sessionIDFromPath(r.URL.Path)
	if sessionID == "" {
		http.NotFound(w, r)
		return
	}
	s := a.getSession(sessionID)
	if s == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "Session not found."})
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.mu.Lock()
		defer s.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "sessionId": s.ID, "uploadedBytes": s.UploadedBytes, "fileSize": s.FileSize,
		})
	case http.MethodPut:
		a.handlePutChunk(w, r, s)
	case http.MethodDelete:
		_ = a.deleteSession(r.Context(), s)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		methodNotAllowed(w)
	}
}

func (a *app) handlePutChunk(w http.ResponseWriter, r *http.Request, s *session) {
	offset, err := strconv.ParseInt(strings.TrimSpace(r.Header.Get("x-upload-offset")), 10, 64)
	if err != nil || offset < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "Missing or invalid offset."})
		return
	}
	chunk, err := io.ReadAll(r.Body)
	if err != nil || len(chunk) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "Empty chunk not allowed."})
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.ObjectReady {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "message": "Upload already finalized.", "uploadedBytes": s.UploadedBytes})
		return
	}
	if s.UploadedBytes != offset {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "message": "Offset mismatch.", "uploadedBytes": s.UploadedBytes})
		return
	}
	if s.UploadedBytes+int64(len(chunk)) > s.FileSize {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "Chunk exceeds declared file size."})
		return
	}

	partNumber := int32(len(s.Parts) + 1)
	out, err := a.s3.UploadPart(r.Context(), &s3.UploadPartInput{
		Bucket: aws.String(a.bucket), Key: aws.String(s.S3Key), UploadId: aws.String(s.UploadID),
		PartNumber: aws.Int32(partNumber), Body: bytes.NewReader(chunk), ContentLength: aws.Int64(int64(len(chunk))),
	})
	if err != nil {
		log.Printf("upload part: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "message": "Upload failed. Please retry."})
		return
	}
	_, _ = s.Digest.Write(chunk)
	s.Parts = append(s.Parts, types.CompletedPart{ETag: out.ETag, PartNumber: aws.Int32(partNumber)})
	s.UploadedBytes += int64(len(chunk))

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "sessionId": s.ID, "uploadedBytes": s.UploadedBytes, "fileSize": s.FileSize,
	})
}

func (a *app) handleComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	var body completeRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "Invalid complete request."})
		return
	}
	if body.SessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "sessionId is required."})
		return
	}

	s, err := a.completeSessionForCallback(r.Context(), body.SessionID)
	if err != nil {
		a.writeCompleteError(w, err)
		return
	}

	payload := map[string]any{
		"pipeline":     callbackPipeline,
		"stagedUpload": buildStagedUploadPayload(s),
	}
	if body.AltName != nil {
		payload["altName"] = *body.AltName
	}
	if body.Transcode != nil {
		payload["transcode"] = *body.Transcode
	}
	if body.UserID != nil {
		payload["userId"] = *body.UserID
	}

	a.forwardFinalize(w, r, payload, []*session{s})
}

func (a *app) forwardFinalize(w http.ResponseWriter, r *http.Request, payload map[string]any, touched []*session) {
	body, err := json.Marshal(payload)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "Failed to prepare request."})
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, a.apiInternalURL+"/api/internal/media-finalized", bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "Failed to prepare request."})
		return
	}
	req.Header.Set("content-type", "application/json")
	if a.internalSecret != "" {
		req.Header.Set("Authorization", "Bearer "+a.internalSecret)
	} else if auth := r.Header.Get("Authorization"); auth != "" {
		req.Header.Set("Authorization", auth)
	}
	if cookie := r.Header.Get("Cookie"); cookie != "" {
		req.Header.Set("Cookie", cookie)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		log.Printf("internal finalize: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "message": "Finalize failed. Please retry."})
		return
	}
	defer resp.Body.Close()

	responseBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		for _, s := range touched {
			_ = a.deleteSession(r.Context(), s)
		}
	}
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(responseBody)
}

func (a *app) completeSessionForCallback(ctx context.Context, sessionID string) (*session, error) {
	s := a.getSession(sessionID)
	if s == nil {
		return nil, errSessionNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.UploadedBytes != s.FileSize {
		return nil, errUploadIncomplete
	}
	if !s.ObjectReady {
		_, err := a.s3.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
			Bucket: aws.String(a.bucket), Key: aws.String(s.S3Key), UploadId: aws.String(s.UploadID),
			MultipartUpload: &types.CompletedMultipartUpload{Parts: s.Parts},
		})
		if err != nil {
			return nil, errFinalizeFailed
		}
		s.ObjectReady = true
		s.Fingerprint = hex.EncodeToString(s.Digest.Sum(nil))
	}
	return s, nil
}

func buildStagedUploadPayload(s *session) stagedUploadPayload {
	return stagedUploadPayload{S3Key: s.S3Key, FileName: s.FileName, MimeType: s.MimeType, FileSize: s.FileSize, Fingerprint: s.Fingerprint}
}

var (
	errSessionNotFound  = errors.New("session not found")
	errUploadIncomplete = errors.New("upload incomplete")
	errFinalizeFailed   = errors.New("finalize failed")
)

func (a *app) writeCompleteError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errSessionNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "Session not found."})
	case errors.Is(err, errUploadIncomplete):
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "Upload is not complete."})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "message": "Finalize failed. Please retry."})
	}
}

func (a *app) getSession(id string) *session {
	a.sessionsMu.RLock()
	defer a.sessionsMu.RUnlock()
	return a.sessions[id]
}

func (a *app) deleteSession(ctx context.Context, s *session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var err error
	if s.ObjectReady {
		_, err = a.s3.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(a.bucket), Key: aws.String(s.S3Key)})
	} else {
		_, err = a.s3.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
			Bucket: aws.String(a.bucket), Key: aws.String(s.S3Key), UploadId: aws.String(s.UploadID),
		})
	}
	a.sessionsMu.Lock()
	delete(a.sessions, s.ID)
	a.sessionsMu.Unlock()
	return err
}

func (a *app) cleanupExpiredSessions(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			now := time.Now().UTC()
			a.sessionsMu.RLock()
			snapshot := make([]*session, 0, len(a.sessions))
			for _, s := range a.sessions {
				snapshot = append(snapshot, s)
			}
			a.sessionsMu.RUnlock()
			for _, s := range snapshot {
				s.mu.Lock()
				expired := now.Sub(s.CreatedAt) > sessionExpiry
				s.mu.Unlock()
				if expired {
					_ = a.deleteSession(context.Background(), s)
				}
			}
		}
	}
}

func (a *app) abortInflightMultipartUploads(ctx context.Context) {
	a.sessionsMu.RLock()
	snapshot := make([]*session, 0, len(a.sessions))
	for _, s := range a.sessions {
		snapshot = append(snapshot, s)
	}
	a.sessionsMu.RUnlock()
	for _, s := range snapshot {
		s.mu.Lock()
		ready := s.ObjectReady
		s.mu.Unlock()
		if !ready {
			_, _ = a.s3.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
				Bucket: aws.String(a.bucket), Key: aws.String(s.S3Key), UploadId: aws.String(s.UploadID),
			})
		}
	}
}

func sessionIDFromPath(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	// api/upload/chunked/<sessionId>
	if len(parts) == 4 && parts[0] == "api" && parts[1] == "upload" && parts[2] == "chunked" {
		return parts[3]
	}
	return ""
}

func canonicalMime(mime string) string {
	base := strings.ToLower(strings.TrimSpace(strings.Split(mime, ";")[0]))
	switch base {
	case "video/3gp":
		return "video/3gpp"
	case "video/m4v":
		return "video/x-m4v"
	case "video/avi":
		return "video/x-msvideo"
	default:
		return base
	}
}

func envInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func envOrDefault(key, fallback string) string {
	if raw := strings.TrimSpace(os.Getenv(key)); raw != "" {
		return raw
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func methodNotAllowed(w http.ResponseWriter) {
	w.Header().Set("allow", "GET, POST, PUT, DELETE")
	http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
}
