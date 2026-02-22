import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const configuredPort = Number(env.VITE_DEV_SERVER_PORT || env.CLIENT_PORT || 5173)
  const port = Number.isFinite(configuredPort) ? configuredPort : 5173

  return {
    plugins: [react()],
    server: {
      port,
      strictPort: false,
    },
  }
})
