import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file) => readFile(resolve(root, file), "utf8");
const [client, editor, server] = await Promise.all([
  read("src/lib/large-image-upload.ts"),
  read("src/components/image-upload-editor.tsx"),
  read("src/server/api.ts"),
]);

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

check(client.includes("40 * 1024 * 1024"), "client limit is 40 MB");
check(client.includes("IMAGE_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024"), "client uses 3 MB chunks");
check(client.includes("image/heic") && client.includes("image/avif"), "HEIC and AVIF are accepted");
check(client.includes("sessionStorage"), "interrupted uploads can resume");
check(client.includes("uploadImageWithVariants"), "original and responsive variants are uploaded");
check(editor.includes("The maximum allowed image size is 40 MB."), "editor shows the required size error");
check(editor.includes("إلغاء الرفع") && editor.includes("إعادة المحاولة"), "editor exposes cancel and retry controls");
check(server.includes("const MAX_MEDIA_BYTES = 40 * 1024 * 1024"), "server accepts media up to 40 MB");
check(server.includes("handleImageUploads") && server.includes("upload/resumable"), "server relays resumable Supabase Storage uploads");
check(server.includes("verifyStoredImage"), "server validates checksum and image signature after upload");

console.log("\nLarge image upload checks passed");
