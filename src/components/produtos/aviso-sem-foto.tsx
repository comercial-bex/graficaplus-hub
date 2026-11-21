import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ImageOff } from "lucide-react";
import { fraseDoAvisoDeFoto, produtosSemFoto, type ProdutoParaAvisoDeFoto } from "@/domain/catalogo/sem-foto";

/**
 * Aviso de produtos sem foto no alto da lista (21/11/2026). Substitui o antigo "Gerar fotos que
 * faltam": o app não gera mais imagem por IA, só mostra o que falta. Cada nome abre a pasta do produto,
 * na aba da foto. Sem produto sem foto, não mostra nada.
 */
export function AvisoSemFoto({ produtos }: { produtos: readonly ProdutoParaAvisoDeFoto[] }) {
  const [aberto, setAberto] = useState(false);
  const faltam = produtosSemFoto(produtos);
  if (faltam.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="aviso-sem-foto"
      className="mt-2 max-w-xl rounded-md border border-[color:var(--bex-amber)]/50 bg-[color:var(--bex-amber)]/10 px-3 py-2 text-base text-foreground"
    >
      <div className="flex items-start gap-2">
        <ImageOff className="mt-1 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p>
            <strong>{fraseDoAvisoDeFoto(faltam.length)}</strong> Envie a foto real de cada um pela pasta do produto.
          </p>
          <button
            type="button"
            className="min-h-11 text-base underline underline-offset-2"
            aria-expanded={aberto}
            onClick={() => setAberto((v) => !v)}
          >
            {aberto ? "Esconder a lista" : "Ver quais são"}
          </button>
          {aberto && (
            <ul className="list-disc space-y-1 pl-5">
              {faltam.map((p) => (
                <li key={p.id}>
                  <Link to="/produtos/$id" params={{ id: p.id }} className="underline underline-offset-2">
                    {p.nome}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
