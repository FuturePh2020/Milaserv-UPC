# Bazaar Pop — EasyOrders custom theme

Arabic-first (RTL), Egypt-focused EasyOrders **Custom Theme** with an energetic illustrated retail style (thick outlines, offset shadows, stickers, wavy section transitions).

- Upload file: [`dist/bazaar-pop-theme.zip`](dist/bazaar-pop-theme.zip)
- Theme source (CLI layout): [`theme/`](theme/)
- Setup & configuration (Arabic): [`docs/README-ar.md`](docs/README-ar.md)
- Compatibility matrix (Arabic): [`docs/compatibility-ar.md`](docs/compatibility-ar.md)
- Asset checklist (Arabic): [`docs/assets-ar.md`](docs/assets-ar.md)
- Testing report & in-store checklist (Arabic): [`docs/testing-report-ar.md`](docs/testing-report-ar.md)

Status: implemented and tested locally (LiquidJS render + Playwright). **Not yet tested inside an EasyOrders store.**

```bash
npm install --no-save liquidjs@10
npm run build && npm run validate
node preview/render.mjs && node preview/test.mjs
npm run zip
```

`preview/` contains preview-only fixtures and a mock storefront; it is never part of the upload.
