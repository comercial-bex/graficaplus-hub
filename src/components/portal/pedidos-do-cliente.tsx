import { useState } from "react";
import { ChevronDown, Download, Eye, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusChip } from "@/components/bex/StatusChip";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erros";
import { formatarData } from "@/domain/os/prazo";
import {
  formatarDia,
  formatarTamanho,
  rotuloDoArquivo,
  rotuloDoDocumento,
  separarOrdens,
  situacaoParaOCliente,
  tipoDePrevia,
  valorDoPedido,
  type OrdemNoPortal,
} from "@/domain/portal/painel-do-cliente";

import {
  abrirEmNovaAba,
  type AlvoDoArquivo,
  type ObterUrl,
} from "@/components/portal/abrir-arquivo";

/**
 * Os pedidos (OS) do cliente — a mesma lista nas duas portas do portal.
 *
 * Quem desenha não sabe de onde vêm os dados: a página logada pede o arquivo
 * ao banco com a sessão do cliente; a página por link pede à rota de servidor
 * com o token. As duas entram aqui pelo `obterUrl`.
 */

export function SituacaoDoPedido({ status }: { status: string }) {
  const s = situacaoParaOCliente(status);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip label={s.titulo} tone={s.tom} />
        {s.esperaPeloCliente && (
          <span className="text-xs font-medium text-[color:var(--bex-amber)]">Falta você</span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{s.detalhe}</p>
      {s.progresso !== null && (
        <Progress
          value={Math.round(s.progresso * 100)}
          className="h-1.5"
          aria-label="Andamento do pedido"
        />
      )}
    </div>
  );
}

export function ListaDePedidos({
  ordens,
  obterUrl,
}: {
  ordens: OrdemNoPortal[];
  obterUrl: ObterUrl;
}) {
  const { abertas, encerradas } = separarOrdens(ordens);
  const [verEncerradas, setVerEncerradas] = useState(false);

  if (ordens.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nenhum pedido aberto ainda. Quando a Bex Print abrir a ordem de serviço do seu pedido, ela
        aparece aqui.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {abertas.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum pedido em andamento agora.</p>
      )}
      {abertas.map((o) => (
        <CartaoDoPedido key={o.id} ordem={o} obterUrl={obterUrl} />
      ))}
      {encerradas.length > 0 && (
        <div className="pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="px-0 text-muted-foreground"
            onClick={() => setVerEncerradas((v) => !v)}
            aria-expanded={verEncerradas}
          >
            <ChevronDown
              className={cn("mr-1 h-4 w-4 transition-transform", verEncerradas && "rotate-180")}
            />
            {verEncerradas ? "Esconder" : "Ver"} {encerradas.length}{" "}
            {encerradas.length === 1
              ? "pedido entregue ou cancelado"
              : "pedidos entregues ou cancelados"}
          </Button>
          {verEncerradas && (
            <div className="mt-2 space-y-3">
              {encerradas.map((o) => (
                <CartaoDoPedido key={o.id} ordem={o} obterUrl={obterUrl} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CartaoDoPedido({ ordem, obterUrl }: { ordem: OrdemNoPortal; obterUrl: ObterUrl }) {
  const [aberto, setAberto] = useState(false);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const anexos = ordem.arquivos.length + ordem.documentos.length;
  const entregue = ordem.entregue_em ? formatarDia(ordem.entregue_em) : null;

  async function abrir(alvo: AlvoDoArquivo) {
    setAbrindo(`${alvo.id}:${alvo.para}`);
    try {
      await abrirEmNovaAba(() => obterUrl(alvo));
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível abrir o arquivo."));
    } finally {
      setAbrindo(null);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-xs text-muted-foreground">Pedido nº {ordem.numero}</div>
          <div className="font-semibold leading-snug">{ordem.titulo || "Pedido sem título"}</div>
        </div>
        {/* O cliente vê o preço do que comprou. Custo e margem nem chegam aqui:
            a função do banco não devolve. */}
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Valor do pedido
          </div>
          <div className="font-mono font-semibold">{valorDoPedido(ordem.valor_pedido)}</div>
        </div>
      </div>

      <SituacaoDoPedido status={ordem.status} />

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {/* Data sem hora: lida no fuso de quem olha, ver domain/os/prazo. */}
        <span>Previsão de entrega: {formatarData(ordem.prazo_entrega)}</span>
        {entregue && <span>Entregue em {entregue}</span>}
        {ordem.precisa_instalacao ? (
          <span>Com instalação</span>
        ) : ordem.precisa_entrega ? (
          <span>Com entrega</span>
        ) : null}
      </div>

      {anexos > 0 ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            className="h-10 md:h-9"
          >
            <FileText className="mr-1 h-4 w-4" />
            {aberto ? "Esconder" : "Ver"} arquivos e documentos ({anexos})
          </Button>
          {aberto && (
            <ul className="mt-3 divide-y rounded-md border">
              {ordem.documentos.map((d) => (
                <LinhaDeAnexo
                  key={d.id}
                  icone={<FileText className="h-4 w-4 shrink-0" />}
                  titulo={rotuloDoDocumento(d)}
                  detalhe={[formatarDia(d.criado_em), formatarTamanho(d.tamanho_bytes)]
                    .filter(Boolean)
                    .join(" · ")}
                  abrindo={abrindo}
                  id={d.id}
                  podeVer={false}
                  onAbrir={(para) =>
                    abrir({ tipo: "documento", id: d.id, nome: rotuloDoDocumento(d), para })
                  }
                />
              ))}
              {ordem.arquivos.map((a) => (
                <LinhaDeAnexo
                  key={a.id}
                  icone={<ImageIcon className="h-4 w-4 shrink-0" />}
                  titulo={a.nome}
                  detalhe={[
                    rotuloDoArquivo(a),
                    a.situacao === "aprovado"
                      ? "aprovada"
                      : a.situacao === "rejeitado"
                        ? "ajuste pedido"
                        : "",
                    formatarDia(a.criado_em),
                    formatarTamanho(a.tamanho_bytes),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  abrindo={abrindo}
                  id={a.id}
                  podeVer={tipoDePrevia(a.mime, a.nome) !== "outro"}
                  onAbrir={(para) => abrir({ tipo: "arquivo", id: a.id, nome: a.nome, para })}
                />
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nenhum arquivo ou documento neste pedido ainda.
        </p>
      )}
    </div>
  );
}

function LinhaDeAnexo({
  icone,
  titulo,
  detalhe,
  id,
  abrindo,
  podeVer,
  onAbrir,
}: {
  icone: React.ReactNode;
  titulo: string;
  detalhe: string;
  id: string;
  abrindo: string | null;
  podeVer: boolean;
  onAbrir: (para: "ver" | "baixar") => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        {icone}
        <div className="min-w-0">
          <div className="truncate font-medium">{titulo}</div>
          {detalhe && <div className="truncate text-xs text-muted-foreground">{detalhe}</div>}
        </div>
      </div>
      <div className="flex gap-1">
        {podeVer && (
          <Button
            size="sm"
            variant="ghost"
            className="h-10 md:h-9"
            disabled={abrindo !== null}
            onClick={() => onAbrir("ver")}
          >
            {abrindo === `${id}:ver` ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Eye className="mr-1 h-4 w-4" />
            )}
            Ver
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-10 md:h-9"
          disabled={abrindo !== null}
          onClick={() => onAbrir("baixar")}
        >
          {abrindo === `${id}:baixar` ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1 h-4 w-4" />
          )}
          Baixar
        </Button>
      </div>
    </li>
  );
}
