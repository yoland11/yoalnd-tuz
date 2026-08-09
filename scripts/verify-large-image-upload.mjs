import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file) => readFile(resolve(root, file), "utf8");
const [client, editor, server, config, tools] = await Promise.all([
  read("src/lib/large-image-upload.ts"),
  read("src/components/image-upload-editor.tsx"),
  read("src/server/api.ts"),
  read("src/lib/image-upload-config.ts"),
  read("src/lib/image-tools.ts"),
]);

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

check(config.includes("maxSourceBytes: 100 * 1024 * 1024"), "central source limit is 100 MB");
check(config.includes("maxLogoOutputBytes: 2 * 1024 * 1024") && config.includes("maxOutputBytes: 8 * 1024 * 1024"), "output targets are centralised");
check(client.includes("IMAGE_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024"), "client uses resumable 3 MB chunks");
check(client.includes("image/heic") && client.includes("image/avif") && client.includes("image/svg+xml"), "HEIC, AVIF and sanitised SVG inputs are accepted");
check(client.includes("source is never uploaded as-is") && client.includes("processImageFile(file"), "source is processed before storage upload");
check(client.includes("sessionStorage"), "interrupted uploads can resume");
check(editor.includes("compressionMode") && editor.includes("image-compression-mode"), "editor exposes compression quality controls");
check(tools.includes("sanitizeSvgFile") && tools.includes("heic2any"), "unsafe SVG is checked and HEIC conversion is available");
check(server.includes("const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024") && server.includes("const MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024"), "server limits generated image objects safely");
check(server.includes("handleImageUploads") && server.includes("upload/resumable"), "server relays resumable Supabase Storage uploads");
check(server.includes("verifyStoredImage"), "server validates checksum and image signature after upload");

console.log("\nLarge image upload checks passed");
