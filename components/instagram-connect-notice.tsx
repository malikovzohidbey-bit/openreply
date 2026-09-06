"use client";

import { useSearchParams } from "next/navigation";

type Tone = "error" | "warning" | "success";

const TONE_CLASSES: Record<Tone, string> = {
  error: "border-error/20 bg-error/10 text-error",
  warning: "border-warning/20 bg-warning/10 text-warning",
  success: "border-success/20 bg-success/10 text-success",
};

const MESSAGES: Record<string, { tone: Tone; title: string; detail: string }> = {
  denied: {
    tone: "warning",
    title: "Instagram ulanishi bekor qilindi",
    detail:
      "Siz Instagram'dagi ruxsat so'rovini rad etdingiz. Qayta boshlang va so'ralgan barcha ruxsatlarni tasdiqlang.",
  },
  invalid: {
    tone: "error",
    title: "Instagram ulanish muddati tugadi",
    detail:
      "Kirish havolasi yo'q edi yoki 10 daqiqadan eski. Qaytadan urinish uchun \"Instagram ulash\" tugmasini bosing.",
  },
  forbidden: {
    tone: "error",
    title: "Ruxsat berilmagan",
    detail:
      "Faqat ish maydoni egalari va administratorlar Instagram akkaunt ulashi mumkin.",
  },
  already_connected: {
    tone: "warning",
    title: "Akkaunt allaqachon ulangan",
    detail:
      "Bu Instagram akkaunt boshqa ish maydoniga ulangan. Avval uni o'sha yerdan uzing yoki boshqa akkaunt ulang.",
  },
};

export function InstagramConnectNotice() {
  const searchParams = useSearchParams();
  const status = searchParams.get("instagram");

  if (!status) return null;

  if (status === "misconfigured") {
    const missing = (searchParams.get("missing") ?? "")
      .split(",")
      .filter(Boolean);

    return (
      <Notice tone="error" title="Instagram ilovasi sozlanmagan">
        <p>
          {missing.length > 0
            ? "Quyidagi environment o'zgaruvchilarni"
            : "Talab qilingan environment o'zgaruvchilarni"}{" "}
          sozlang va serverni qayta ishga tushiring:
        </p>
        {missing.length > 0 && (
          <ul className="mt-2 space-y-1">
            {missing.map((name) => (
              <li key={name} className="font-mono text-xs">
                {name}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2">
          Har bir qiymatni qanday olish haqida{" "}
          <span className="font-mono text-xs">docs/setup.md</span> ga qarang.
          Diqqat, <span className="font-mono text-xs">ENCRYPTION_KEY</span> 64
          belgili hex satr bo'lishi kerak.
        </p>
      </Notice>
    );
  }

  if (status === "failed") {
    const reason = searchParams.get("reason");

    return (
      <Notice tone="error" title="Instagram ulanishi amalga oshmadi">
        <p>
          Instagram kirishni qabul qildi, lekin ulanishni yakunlab bo'lmadi.
          Odatda buning sababi noto'g'ri redirect URI yoki kerakli
          ruxsatlarga ega bo'lmagan ilova.
        </p>
        {reason && (
          <p className="mt-2 font-mono text-xs break-words opacity-80">
            {reason}
          </p>
        )}
      </Notice>
    );
  }

  const known = MESSAGES[status];
  if (!known) return null;

  return (
    <Notice tone={known.tone} title={known.title}>
      <p>{known.detail}</p>
    </Notice>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded border p-4 text-sm ${TONE_CLASSES[tone]}`}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 opacity-90">{children}</div>
    </div>
  );
}
