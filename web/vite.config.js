import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  resolve: {
    alias: {
      "~@ibm": path.resolve(__dirname, "node_modules/@ibm")
    }
  },
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false
  }
});
