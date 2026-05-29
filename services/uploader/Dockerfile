FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/uploader .

FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/uploader /uploader
EXPOSE 8080
ENTRYPOINT ["/uploader"]
