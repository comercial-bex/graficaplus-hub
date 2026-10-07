import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Link2, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { rotuloDe } from "@/domain/os/etapas";
import type { ConversaDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import {
  CHAVES,
  acionarEnvio,
  buscarParaVincular,
  subirAnexo,
  useVinculosDaConversa,
  type VinculoResumo,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { acaoNaConversa, enfileirarArquivo } from "@/lib/api/whatsapp-caixa.functions";

const brl = (v: number | null) =>
  v == null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Orçamentos e OS ligados a esta conversa, vincular existentes e mandar o PDF. */
export function VinculosDaConversa({ conversa, podeEditar }: { conversa: ConversaDaCaixa; podeEditar: boolean }) {
  const { nivelDeVisao } = useAuth();
  const qc = useQueryClient();
  const vinculos = useVinculosDaConversa(conversa.id, conversa.os_id, nivelDeVisao);
  const acao = useServerFn(acaoNaConversa);
  const enviarArquivo = useServerFn(enfileirarArquivo);
  const [enviandoPdf, setEnviandoPdf] = useState<string | null>(null);

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["wa-caixa-vinculos", conversa.id] });
    void qc.invalidateQueries({ queryKey: CHAVES.conversas });
    void qc.invalidateQueries({ queryKey: ["wa-caixa-eventos", conversa.id] });
  };

  async function vincular(tipo: "orcamentos" | "ordens_servico", id: string) {
    try {
      const r = await acao({
        data:
          tipo === "orcamentos"
            ? { acao: "vincular_orcamento", conversaId: conversa.id, orcamentoId: id }
            : { acao: "vincular_os", conversaId: conversa.id, osId: id },
      });
      toast.success(
        tipo === "orcamentos"
          ? r.cliente_herdado
            ? "Orçamento vinculado — a conversa herdou o cliente dele"
            : "Orçamento vinculado"
          : "OS vinculada",
      );
      recarregar();
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  }

  async function enviarPdf(o: VinculoResumo) {
    setEnviandoPdf(o.id);
    try {
      const { carregarPropsOrcamento, renderPDFBlob } = await import("@/lib/pdf/generate");
      const props = await carregarPropsOrcamento(o.id, true, nivelDeVisao);
      const blob = await renderPDFBlob(props);
      const nome = `Orcamento-${o.numero}.pdf`;
      const caminho = await subirAnexo(conversa.id, new Blob([blob], { type: "application/pdf" }), nome);
      const r = await enviarArquivo({
        data: { conversaId: conversa.id, tipo: "documento", caminho, nomeArquivo: nome, legenda: `Orçamento #${o.numero}` },
      });
      void qc.invalidateQueries({ queryKey: CHAVES.mensagens(conversa.id) });
      const http = await acionarEnvio();
      const saiu =
        !("falhaDeRede" in http) &&
        http.corpo?.resultados?.some((x) => x.fila_id === r.fila_id && x.situacao === "enviada");
      if (saiu) toast.success(`PDF do orçamento #${o.numero} enviado`);
      else toast.warning("PDF na fila — sai assim que o WhatsApp aceitar.");
      void qc.invalidateQueries({ queryKey: CHAVES.mensagens(conversa.id) });
    } catch (e) {
      toast.error(`O PDF não foi enviado: ${mensagemErro(e)}`);
    } finally {
      setEnviandoPdf(null);
    }
  }

  const orcs = vinculos.data?.orcamentos ?? [];
  const os = vinculos.data?.os ?? null;

  return (
    <section className="space-y-2 border-b p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Ligados a esta conversa</div>
      {vinculos.isPending ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : vinculos.isError ? (
        <p className="text-xs text-destructive">{mensagemErro(vinculos.error)}</p>
      ) : orcs.length === 0 && !os ? (
        <p className="text-xs text-muted-foreground">Nenhum orçamento ou OS vinculado ainda.</p>
      ) : (
        <div className="space-y-1.5 text-sm">
          {orcs.map((o) => (
            <div key={o.id} className="space-y-1 rounded border p-2">
              <div className="flex items-center justify-between gap-2">
                <Link to="/orcamentos/$id" params={{ id: o.id }} className="truncate font-medium hover:underline">
                  Orç. #{o.numero} · {o.titulo}
                </Link>
                <Badge variant="outline" className="shrink-0 text-[10px]">{o.status}</Badge>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{brl(o.valor_total)}</span>
                {podeEditar && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={!!enviandoPdf} onClick={() => void enviarPdf(o)}>
                    {enviandoPdf === o.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FileText className="mr-1 h-3 w-3" />}
                    Enviar PDF do orçamento
                  </Button>
                )}
              </div>
            </div>
          ))}
          {os && (
            <div className="flex items-center justify-between gap-2 rounded border p-2">
              <Link to="/os/$id" params={{ id: os.id }} className="truncate font-medium hover:underline">
                OS #{os.numero} · {os.titulo}
              </Link>
              <span className="shrink-0 text-right text-[10px] text-muted-foreground">
                {rotuloDe(os.status)}
                <br />
                {brl(os.valor_total)}
              </span>
            </div>
          )}
        </div>
      )}
      {podeEditar && (
        <div className="flex flex-wrap gap-1.5">
          <Buscador rotulo="Vincular orçamento existente" tabela="orcamentos" onEscolher={(id) => void vincular("orcamentos", id)} />
          <Buscador rotulo="Vincular OS existente" tabela="ordens_servico" onEscolher={(id) => void vincular("ordens_servico", id)} />
        </div>
      )}
    </section>
  );
}

function Buscador({
  rotulo,
  tabela,
  onEscolher,
}: {
  rotulo: string;
  tabela: "orcamentos" | "ordens_servico";
  onEscolher: (id: string) => void;
}) {
  const { nivelDeVisao } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<Awaited<ReturnType<typeof buscarParaVincular>>>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(() => {
      setCarregando(true);
      setErro(null);
      buscarParaVincular(tabela, termo, nivelDeVisao)
        .then(setLista)
        .catch((e) => setErro(mensagemErro(e)))
        .finally(() => setCarregando(false));
    }, 300);
    return () => clearTimeout(t);
  }, [aberto, termo, tabela, nivelDeVisao]);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <Link2 className="mr-1 h-3 w-3" /> {rotulo}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-2" align="start">
        <div className="relative mb-2">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            autoFocus
            className="h-8 pl-7 text-xs"
            placeholder="Número, título ou cliente"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
          />
        </div>
        {carregando ? (
          <p className="p-2 text-xs text-muted-foreground">Buscando…</p>
        ) : erro ? (
          <p className="p-2 text-xs text-destructive">{erro}</p>
        ) : lista.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">Nada encontrado.</p>
        ) : (
          <div className="max-h-64 overflow-auto">
            {lista.map((l) => (
              <button
                key={l.id}
                type="button"
                className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => {
                  onEscolher(l.id);
                  setAberto(false);
                }}
              >
                <div className="font-medium">
                  #{l.numero} · {l.titulo}
                </div>
                <div className="text-muted-foreground">
                  {l.cliente_nome ?? "sem cliente"} · {l.status}
                  {l.valor_total != null && ` · ${brl(l.valor_total)}`}
                </div>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
