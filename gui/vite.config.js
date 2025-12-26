import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000
  },
  build: {
    outDir: 'dist',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_debugger: false
      },
      mangle: {
        safari10: true
      }
    },
    rollupOptions: {
      output: {
        // 単一ファイルとして出力
        entryFileNames: 'app.js',
        chunkFileNames: 'app.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name.endsWith('.css')) {
            return 'app.css'
          }
          return assetInfo.name
        },
        manualChunks: undefined  // チャンク分割無効化
      }
    },
    // 追加の最適化設定
    cssCodeSplit: false,         // CSS分割無効化
    reportCompressedSize: true,  // 圧縮サイズレポート
    chunkSizeWarningLimit: 1000  // 警告しきい値を1MBに
  }
})
