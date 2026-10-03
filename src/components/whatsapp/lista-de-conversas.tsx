import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusChip } from "@/components/bex/StatusChip";
import { cn } from "@/lib/utils";
import {
  estaAberta,
  horaCurta,
  nomeDaConversa,
  telefoneLegivel,
  type Aba,
  type ConversaDaCaixa,
} from "@/domain/whatsapp/caixa-de-entrada";

const ABAS: { valor: Aba; rotulo: string }[] = [
  { valor: "abertas", rotulo: "Abertas" },
  { valor: "concluidas", rotulo: "Concluídas" },
  { valor: "todas", rotulo: "Todas" },
];

/** A coluna da esquerda: quem escreveu, o que disse por último e quanto falta ler. */
export function ListaDeConversas({
  conversas,
  totalCarregado,
  limiteAtingido,
  contagem,
  selecionadaId,
  onSelecionar,
  busca,
  onBusca,
  aba,
  onAba,
  className,
}: {
  conversas: ConversaDaCaixa[];
  totalCarregado: number;
  limiteAtingido: boolean;
  contagem: Record<Aba, number>;
  selecionadaId: string | null;
  onSelecionar: (id: string) => void;
  busca: string;
  onBusca: (v: string) => void;
  aba: Aba;
  onAba: (a: Aba) => void;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <div className="space-y-2 border-b p-3">
        <div className="flex gap-1" role="tablist" aria-label="Filtrar conversas">
          {ABAS.map((a) => (
            <button
              key={a.valor}
              type="button"
              role="tab"
              aria-selected={aba === a.valor}
              onClick={() => onAba(a.valor)}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                aba === a.valor
                  ? "bg-[color:var(--bex-cyan)]/15 text-[color:var(--bex-cyan)]"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {a.rotulo} <span className="font-mono">({contagem[a.valor]})</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Nome, telefone, etiqueta…"
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
            aria-label="Buscar conversa"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {conversas.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {busca.trim()
              ? "Nenhuma conversa com esse termo."
              : aba === "abertas"
                ? "Nenhuma conversa aberta. As concluídas estão na aba ao lado."
                : "Nenhuma conversa nesta aba."}
          </p>
        ) : (
          conversas.map((c) => {
            const nome = nomeDaConversa(c);
            const naoLidas = c.nao_lidas ?? 0;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelecionar(c.id)}
                aria-current={selecionadaId === c.id ? "true" : undefined}
                className={cn(
                  "w-full border-b p-3 text-left transition-colors hover:bg-muted/50",
                  selecionadaId === c.id && "bg-muted",
                )}
              >
                <div className="flex items-start gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback>{nome.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm",
                          naoLidas > 0 ? "font-bold" : "font-medium",
                        )}
                      >
                        {nome}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {horaCurta(c.ultima_mensagem_at)}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.ultima_mensagem || "Sem mensagens"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {c.cliente ? (
                        <Badge variant="outline" className="py-0 text-[10px]">
                          cliente
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {telefoneLegivel(c.telefone)}
                        </span>
                      )}
                      {!estaAberta(c) && <StatusChip label="concluída" tone="muted" />}
                      {(c.etiquetas ?? []).slice(0, 2).map((e) => (
                        <Badge key={e} variant="outline" className="py-0 text-[10px]">
                          {e}
                        </Badge>
                      ))}
                      {naoLidas > 0 && (
                        <Badge
                          className="ml-auto bg-emerald-600 py-0 text-[10px] hover:bg-emerald-600"
                          aria-label={`${naoLidas} não lida(s)`}
                        >
                          {naoLidas}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
        {limiteAtingido && (
          <p className="p-3 text-center text-[11px] text-muted-foreground">
            Mostrando as {totalCarregado} conversas mais recentes. As mais antigas ficam fora desta
            lista.
          </p>
        )}
      </div>
    </Card>
  );
}
