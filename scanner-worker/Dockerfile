FROM golang:1.24-alpine AS build
WORKDIR /src
COPY gateway/main.go ./main.go
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/seramet-scanner-gateway ./main.go

FROM clamav/clamav:1.4
COPY --from=build /out/seramet-scanner-gateway /usr/local/bin/seramet-scanner-gateway
COPY start.sh /usr/local/bin/seramet-scanner-start
RUN chmod 0555 /usr/local/bin/seramet-scanner-gateway /usr/local/bin/seramet-scanner-start
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/seramet-scanner-start"]
