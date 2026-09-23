FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY go.mod go.sum main.go ./
RUN go mod download && go mod verify
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/uploader .

FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/uploader /uploader
EXPOSE 8080
ENTRYPOINT ["/uploader"]
