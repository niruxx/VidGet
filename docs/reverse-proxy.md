# Running Vidget behind a reverse proxy

A public instance should sit behind a reverse proxy such as Caddy or nginx. The proxy handles HTTPS, and Vidget only listens on the local machine.

## 1. Tell Vidget it is behind a proxy

In the admin portal (`/admin`) under **Server**:

1. Set **Listen address** to `127.0.0.1`. Vidget can then only be reached through the proxy. (You can also start Vidget with the `HOST=127.0.0.1` environment variable.)
2. Turn on **Behind a reverse proxy**.
3. Restart Vidget so the new listen address takes effect.

"Behind a reverse proxy" makes Vidget trust the `X-Forwarded-For` header from the first proxy in front of it. Without it, every visitor appears to come from `127.0.0.1`, so they would all share a single rate limit and job limit. Only the closest proxy is trusted, so a visitor can't bypass the limits by sending a fake `X-Forwarded-For` header.

It also lets Vidget see that the original request used HTTPS (from `X-Forwarded-Proto`), so the admin login cookie gets the `Secure` flag.

## 2. Configure the proxy

Three things matter for Vidget:

- **Upload size.** The proxy must accept uploads at least as large as the limits set in `/admin` (default 2 GB for video).
- **Streaming.** Progress updates are sent as a live stream (Server-Sent Events). Response buffering must be off, or progress bars freeze until the job finishes.
- **Timeouts.** Large uploads and long conversions can take a while. Don't cut off connections after the usual 60 seconds.

### Caddy

Caddy obtains HTTPS certificates automatically and adds `X-Forwarded-For` / `X-Forwarded-Proto` by default.

```caddy
vidget.example.com {
	encode zstd gzip

	request_body {
		max_size 2GB
	}

	reverse_proxy 127.0.0.1:3000 {
		# Send progress updates to the browser immediately.
		flush_interval -1
	}
}
```

### nginx

```nginx
server {
    listen 80;
    server_name vidget.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name vidget.example.com;

    ssl_certificate     /etc/letsencrypt/live/vidget.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vidget.example.com/privkey.pem;

    # Must be at least the upload limit set in /admin.
    client_max_body_size 2g;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Live progress (Server-Sent Events) and big uploads.
        proxy_buffering         off;
        proxy_request_buffering off;
        proxy_read_timeout      1h;
        proxy_send_timeout      1h;
    }
}
```

Get a certificate with `certbot --nginx -d vidget.example.com`, or use any other ACME client.

### More than one proxy (e.g. Cloudflare in front of nginx)

Vidget trusts exactly one proxy hop. With a CDN in front of your proxy, nginx has to restore the real visitor IP before passing the request on. Otherwise every visitor shares the CDN's IP. For Cloudflare, use nginx's `real_ip` module with Cloudflare's published IP ranges:

```nginx
# in the http {} block; repeat set_real_ip_from for each Cloudflare range
set_real_ip_from 173.245.48.0/20;
real_ip_header CF-Connecting-IP;
```

## 3. Check it

- `https://vidget.example.com/api/health` should return `"status": "ok"`.
- `http://YOUR-SERVER-IP:3000` should **not** load, because Vidget only listens on `127.0.0.1`.
- Start a conversion. The progress bar should move smoothly. If it jumps from 0 to 100%, response buffering is still on.
- In `/admin` → **Abuse protection**, set **Requests per visitor per minute** to something low (e.g. 3). Load a few links from two different networks: each should hit the limit separately. Then set it back.
