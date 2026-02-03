# Nginx Optimization for Static Assets & Caching

## Overview
This guide covers nginx configuration for optimal static asset delivery, caching, and compression to improve page load performance.

---

## 1. Static File Caching Headers

Add to your nginx server block or location blocks:

```nginx
# Serve static files with aggressive caching
location ~* \.(webp|jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot|otf)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    access_log off;
}

# CSS and JS with shorter cache (in case of updates)
location ~* \.(css|js)$ {
    expires 30d;
    add_header Cache-Control "public, must-revalidate";
    access_log off;
}

# HTML files - no cache (always fetch fresh)
location ~* \.html$ {
    expires -1;
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
}
```

---

## 2. Compression (Gzip & Brotli)

### Gzip Configuration
```nginx
# Enable gzip compression
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types
    text/plain
    text/css
    text/xml
    text/javascript
    application/json
    application/javascript
    application/xml+rss
    application/rss+xml
    font/truetype
    font/opentype
    application/vnd.ms-fontobject
    image/svg+xml;
gzip_disable "msie6";
```

### Brotli Configuration (Better compression than gzip)
```nginx
# Install: apt-get install nginx-module-brotli
load_module modules/ngx_http_brotli_filter_module.so;
load_module modules/ngx_http_brotli_static_module.so;

http {
    brotli on;
    brotli_comp_level 6;
    brotli_static on;
    brotli_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/rss+xml
        font/truetype
        font/opentype
        application/vnd.ms-fontobject
        image/svg+xml;
}
```

---

## 3. Complete Server Block Example

```nginx
server {
    listen 80;
    server_name demo.playmatatu.com;
    
    # Root directory
    root /var/www/playmatatu/frontend/dist;
    index index.html;

    # Compression
    gzip on;
    gzip_vary on;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss image/svg+xml;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Images and fonts - long cache
    location ~* \.(webp|jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot|otf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # CSS and JS - medium cache
    location ~* \.(css|js)$ {
        expires 30d;
        add_header Cache-Control "public, must-revalidate";
        access_log off;
    }

    # HTML - no cache
    location ~* \.html$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    # API proxy
    location /api/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /ws/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # WebSocket timeouts
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # SPA fallback - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 4. CDN Setup (CloudFlare Free Tier)

### Benefits:
- Global edge locations
- Automatic compression
- DDoS protection
- Free SSL
- Image optimization

### Setup Steps:

1. **Add Site to CloudFlare:**
   - Go to cloudflare.com
   - Add your domain
   - Update nameservers at your domain registrar

2. **Configure Caching:**
   - Go to Caching → Configuration
   - Set Cache Level: "Standard"
   - Browser Cache TTL: "1 year"

3. **Enable Auto Minify:**
   - Speed → Optimization
   - Enable: JavaScript, CSS, HTML

4. **Enable Brotli:**
   - Speed → Optimization
   - Enable "Brotli compression"

5. **Page Rules (Optional):**
   ```
   demo.playmatatu.com/api/*
   → Cache Level: Bypass
   
   demo.playmatatu.com/*
   → Cache Level: Cache Everything
   → Edge Cache TTL: 1 month
   ```

---

## 5. Testing & Verification

### Test Compression:
```bash
# Check if gzip is working
curl -I -H "Accept-Encoding: gzip" https://demo.playmatatu.com/logo.webp

# Should see:
# Content-Encoding: gzip
# or
# Content-Encoding: br (brotli)
```

### Test Cache Headers:
```bash
curl -I https://demo.playmatatu.com/logo.webp

# Should see:
# Cache-Control: public, immutable
# Expires: (future date ~1 year)
```

### Performance Testing Tools:
- **PageSpeed Insights**: https://pagespeed.web.dev/
- **GTmetrix**: https://gtmetrix.com/
- **WebPageTest**: https://www.webpagetest.org/

---

## 6. Expected Improvements

### Before Optimization:
- Images: 684KB uncompressed
- No caching
- Full reload on every visit

### After Optimization:
- Images: 224KB (WebP)
- With compression: ~180KB (gzip/brotli)
- Cached after first visit
- Instant loads on repeat visits

### Performance Gains:
- ✅ 67% smaller images
- ✅ ~20% additional compression savings
- ✅ 90%+ faster repeat visits (cached)
- ✅ Better CLS scores
- ✅ Improved Core Web Vitals

---

## 7. Maintenance

### Cache Busting:
When you update assets, change filenames or use query strings:
```
/logo.webp?v=2
/background.webp?v=1.2.0
```

Or use Vite's built-in hash filenames (already done):
```
/assets/logo-abc123.webp
```

### Monitor Cache Hit Rate:
```bash
# CloudFlare Analytics → Caching
# Look for >90% cache hit rate
```

---

## Troubleshooting

### Images not caching:
- Check nginx config syntax: `nginx -t`
- Restart nginx: `systemctl restart nginx`
- Clear browser cache and test

### Compression not working:
- Verify modules loaded: `nginx -V 2>&1 | grep brotli`
- Check file sizes: compression only works on files >1KB

### CDN not caching:
- Check CloudFlare page rules
- Purge cache: CloudFlare dashboard → Caching → Purge Everything
- Wait 5 minutes for propagation
