import { defineConfig } from 'vite';

// https://vitejs.dev/config/
// `base` must match the GitHub Pages subpath:
// https://<user>.github.io/<repo>/  ->  base: '/<repo>/'
export default defineConfig({
    base: '/sf-gltf-viewer/',
    server: {
        port: 5173,
        open: true,
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
});
