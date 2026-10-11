# --- build stage -----------------------------------------------------------
FROM golang:1.22-bookworm AS builder
WORKDIR /app

COPY go.mod ./
COPY . .

RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server

# --- run stage ---------------------------------------------------------
FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --create-home cyclesafe
WORKDIR /app

COPY --from=builder /out/server ./server
COPY data ./data

USER cyclesafe
EXPOSE 8080
ENTRYPOINT ["./server"]
