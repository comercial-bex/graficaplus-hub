import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * QR Code do Pix copia e cola. A biblioteca só é baixada quando o QR aparece. Sempre em preto sobre
 * branco com margem, que é o que os aplicativos de banco leem melhor, mesmo no tema escuro.
 */
export function QrCodeDoPix({ texto, tamanho = 176, className }: { texto: string; tamanho?: number; className?: string }) {
  const [imagem, setImagem] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    setFalhou(false);
    void import("qrcode")
      .then((QR) => QR.toDataURL(texto, { errorCorrectionLevel: "M", margin: 2, width: tamanho * 2, color: { dark: "#000000", light: "#FFFFFF" } }))
      .then((url) => vivo && setImagem(url))
      .catch(() => vivo && setFalhou(true));
    return () => {
      vivo = false;
    };
  }, [texto, tamanho]);

  if (falhou) return <p className="text-xs text-destructive">Não consegui desenhar o QR Code. Use o copia e cola.</p>;
  return (
    <div className={cn("shrink-0 rounded-lg bg-white p-1", className)} style={{ width: tamanho + 8, height: tamanho + 8 }}>
      {imagem ? <img src={imagem} alt="QR Code do Pix" width={tamanho} height={tamanho} /> : <div className="h-full w-full animate-pulse rounded bg-muted" aria-hidden />}
    </div>
  );
}
