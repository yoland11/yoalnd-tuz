import { useCallback, useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Download, Heart, Image as ImageIcon, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Public client gallery (route /gallery/:slug).
 *
 * Unauthenticated by design: the long random slug is the primary control and an optional
 * password is the second factor. Previews are thumbnails; the actual download is always an
 * external link supplied by staff.
 */

type Item = {
  id: number;
  title: string | null;
  kind: string;
  previewImage: string | null;
  downloadUrl: string | null;
  favoriteCount: number;
};

type Payload = { title: string; expiresAt: string | null; items: Item[] };

/** Stable per-browser token so favourites survive a reload without any personal data. */
function visitorToken(): string {
  const key = "ajn-gallery-visitor";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const token =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replaceAll("-", "")
        : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, token);
    return token;
  } catch {
    return "";
  }
}

function readFavorites(slug: string): number[] {
  try {
    return JSON.parse(localStorage.getItem(`ajn-gallery-fav-${slug}`) ?? "[]");
  } catch {
    return [];
  }
}

function writeFavorites(slug: string, ids: number[]) {
  try {
    localStorage.setItem(`ajn-gallery-fav-${slug}`, JSON.stringify(ids));
  } catch {
    /* storage is best effort */
  }
}

export default function ClientGalleryPage() {
  const [, params] = useRoute("/gallery/:slug");
  const slug = params?.slug ?? "";
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "locked" | "error" | "ready">("loading");
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [favorites, setFavorites] = useState<number[]>([]);

  const open = useCallback(
    async (suppliedPassword?: string) => {
      if (!slug) return;
      setBusy(true);
      try {
        const response = await fetch(`/api/photo-gallery/${encodeURIComponent(slug)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: suppliedPassword ?? undefined, visitorToken: visitorToken() }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setTitle(payload?.title ?? "");
          setMessage(payload?.error ?? "تعذّر فتح المعرض");
          setState(payload?.needsPassword ? "locked" : "error");
          return;
        }
        setData(payload);
        setFavorites(readFavorites(slug));
        setState("ready");
      } catch {
        setMessage("تعذّر الاتصال بالخادم");
        setState("error");
      } finally {
        setBusy(false);
      }
    },
    [slug],
  );

  useEffect(() => { open(); }, [open]);

  async function act(action: "download" | "favorite" | "unfavorite", itemId: number) {
    try {
      await fetch(`/api/photo-gallery/${encodeURIComponent(slug)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, password: password || undefined, visitorToken: visitorToken() }),
      });
    } catch {
      /* tracking is best effort — it must never block the download itself */
    }
  }

  function toggleFavorite(item: Item) {
    const isFavorite = favorites.includes(item.id);
    const next = isFavorite ? favorites.filter((id) => id !== item.id) : [...favorites, item.id];
    setFavorites(next);
    writeFavorites(slug, next);
    void act(isFavorite ? "unfavorite" : "favorite", item.id);
  }

  if (state === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center bg-background" dir="rtl">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </main>
    );
  }

  if (state === "locked") {
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-5" dir="rtl">
        <form
          onSubmit={(event) => { event.preventDefault(); open(password); }}
          className="w-full max-w-sm space-y-3 rounded-2xl border border-border/40 bg-card p-5 text-center"
        >
          <Lock className="mx-auto h-8 w-8 text-primary" />
          <h1 className="text-lg font-bold text-foreground">{title || "معرض محمي"}</h1>
          <p className="text-sm text-muted-foreground">أدخل كلمة المرور لعرض الصور.</p>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="كلمة المرور"
            autoFocus
          />
          {message ? <p className="text-xs text-destructive">{message}</p> : null}
          <Button className="w-full" disabled={busy || !password}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "فتح المعرض"}
          </Button>
        </form>
      </main>
    );
  }

  if (state === "error" || !data) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-5 text-center" dir="rtl">
        <div className="space-y-2">
          <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">{message || "المعرض غير متاح"}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-background" dir="rtl">
      <header className="border-b border-border/30 px-5 py-6 text-center">
        <h1 className="text-xl font-bold text-foreground">{data.title}</h1>
        {data.expiresAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            الرابط صالح حتى {new Date(data.expiresAt).toLocaleDateString("ar-IQ")}
          </p>
        ) : null}
      </header>

      {data.items.length ? (
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.items.map((item) => {
            const isFavorite = favorites.includes(item.id);
            return (
              <figure key={item.id} className="overflow-hidden rounded-xl border border-border/30 bg-card">
                {item.previewImage ? (
                  <img src={item.previewImage} alt={item.title ?? ""} loading="lazy" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="grid aspect-square w-full place-items-center bg-muted">
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <figcaption className="flex items-center justify-between gap-1 p-2">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(item)}
                    aria-label={isFavorite ? "إزالة من المفضلة" : "إضافة للمفضلة"}
                    aria-pressed={isFavorite}
                    className="grid h-9 w-9 place-items-center rounded-lg"
                  >
                    <Heart className={`h-4 w-4 ${isFavorite ? "fill-destructive text-destructive" : "text-muted-foreground"}`} />
                  </button>
                  {item.downloadUrl ? (
                    <a
                      href={item.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => act("download", item.id)}
                      aria-label="تحميل"
                      className="grid h-9 w-9 place-items-center rounded-lg text-primary"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  ) : null}
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : (
        <p className="p-10 text-center text-sm text-muted-foreground">لم تُضَف صور بعد.</p>
      )}
    </main>
  );
}
