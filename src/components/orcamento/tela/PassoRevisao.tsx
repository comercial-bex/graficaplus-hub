import type { Dispatch, SetStateAction } from "react";
import type { Permission } from "@/lib/permissions";
import { ONDE_RESOLVER } from "./comum";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PASSOS_DA_EQUIPE, passoDaPendencia } from "@/domain/orcamentos/passos-da-equipe";
import { brl, dataBR, descricaoDaCondicao, lerCondicao, m2 } from "@/domain/orcamentos/acordo";
import { rotuloDaPorcentagem } from "@/domain/parceiros/prazo";
import { Dica } from "@/components/bex/Dica";
import { dicaAcao } from "@/lib/dicas";
import { Button } from "@/components/ui/button";
import { FileDown, Link as LinkIcon, Loader2, MessageCircle, Printer } from "lucide-react";
import { PDFHistoryCard } from "@/lib/pdf/PDFHistoryCard";
import type { AcordoDoOrcamento } from "@/components/orcamento/acordo-do-orcamento";
import type { PassoDoOrcamento } from "@/domain/parceiros/passos-do-orcamento";

export function PassoRevisao({
  canSeePrices,
  condicao,
  copiarLinkCliente,
  dadosDoAcordo,
  enviandoPeloSistema,
  enviarPeloSistema,
  enviarWhatsApp,
  fechado,
  gerandoLink,
  hasPermission,
  id,
  irParaPasso,
  itensDeProduto,
  lembrando,
  lembrarCliente,
  linhaDaTaxa,
  orc,
  pendencias,
  podeMandar,
  setPreviewOpen,
  setPreviewProducaoOpen,
  somaArea,
  taxaDoPrazoDoOrcamento,
}: {
  canSeePrices: boolean;
  condicao: { forma?: string | null; parcelas?: number | null; } | null;
  copiarLinkCliente: () => Promise<void>;
  dadosDoAcordo: AcordoDoOrcamento | null;
  enviandoPeloSistema: boolean;
  enviarPeloSistema: () => Promise<void>;
  enviarWhatsApp: () => Promise<void>;
  fechado: boolean;
  gerandoLink: boolean;
  hasPermission: (permission: Permission) => boolean;
  id: any;
  irParaPasso: (p: PassoDoOrcamento, alvo?: string) => void;
  itensDeProduto: any[];
  lembrando: boolean;
  lembrarCliente: () => Promise<void>;
  linhaDaTaxa: any;
  orc: any;
  pendencias: string[];
  podeMandar: boolean;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
  setPreviewProducaoOpen: Dispatch<SetStateAction<boolean>>;
  somaArea: number;
  taxaDoPrazoDoOrcamento: number;
}) {
  return (
    <>
      <Card id="passo-revisao" className="scroll-mt-48">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{PASSOS_DA_EQUIPE[3].pergunta}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {fechado ? (
            <p className="text-sm text-muted-foreground">
              Este orçamento já virou OS: o que foi vendido fica como foi combinado.
            </p>
          ) : pendencias.length === 0 ? (
            <p className="text-sm">Nada falta para mandar ao cliente.</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Antes de mandar ao cliente, falta:</p>
              <ul className="space-y-1 text-sm">
                {pendencias.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      className="text-amber-600 underline underline-offset-2 hover:text-amber-500"
                      onClick={() => irParaPasso(passoDaPendencia(p), ONDE_RESOLVER[p])}
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
    
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Cliente</dt>
              <dd className="font-medium">{orc.cliente_nome || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Itens</dt>
              <dd className="font-medium">
                {itensDeProduto.length}
                {somaArea > 0 ? ` · ${m2(somaArea)}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Prazo de produção</dt>
              <dd className="font-medium">
                {linhaDaTaxa
                  ? `Expresso (+${rotuloDaPorcentagem(taxaDoPrazoDoOrcamento)} sobre os produtos)`
                  : "Normal"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Entrega</dt>
              <dd className="font-medium">
                {dadosDoAcordo?.data_entrega_prometida ?? dadosDoAcordo?.prazo
                  ? dataBR((dadosDoAcordo?.data_entrega_prometida ?? dadosDoAcordo?.prazo) as string)
                  : "sem data"}
              </dd>
            </div>
            {canSeePrices && (
              <div>
                <dt className="text-muted-foreground">Pagamento</dt>
                <dd className="font-medium">
                  {condicao?.forma ?? "forma não escolhida"}
                  {dadosDoAcordo?.condicao_pagamento
                    ? ` · ${descricaoDaCondicao(lerCondicao(dadosDoAcordo.condicao_pagamento), Number(orc.valor_total ?? 0))}`
                    : ""}
                </dd>
              </div>
            )}
            {canSeePrices && (
              <div>
                <dt className="text-muted-foreground">Total</dt>
                <dd className="font-semibold tabular-nums">{brl(orc.valor_total)}</dd>
              </div>
            )}
          </dl>
    
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Dica texto={dicaAcao("/orcamentos", "pdf")}><Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <FileDown className="h-4 w-4 mr-1" /> PDF
          </Button></Dica>
          <Dica texto={dicaAcao("/orcamentos", "producao")}><Button variant="outline" size="sm" onClick={() => setPreviewProducaoOpen(true)}>
            <Printer className="h-4 w-4 mr-1" /> Via de produção
          </Button></Dica>
          {podeMandar && (
            <>
              <Dica texto={dicaAcao("/orcamentos", "link")}><Button variant="outline" size="sm" onClick={copiarLinkCliente} disabled={gerandoLink}>
                {gerandoLink ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <LinkIcon className="h-4 w-4 mr-1" />
                )}
                Link do cliente
              </Button></Dica>
              <Dica texto="Envia o PDF e o link de aprovação direto na conversa do cliente, pelo WhatsApp da gráfica."><Button size="sm" onClick={enviarPeloSistema} disabled={enviandoPeloSistema || gerandoLink}>
                {enviandoPeloSistema ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-1" />} Enviar pelo sistema
              </Button></Dica>
              {orc.status === "enviado" && hasPermission("whatsapp.reply") && (orc as any).enviado_em &&
                Date.now() - new Date((orc as any).enviado_em).getTime() > 48 * 3600_000 && (
                  <Dica texto="O cliente não respondeu há mais de 48 horas. Manda um lembrete curto com o link, pelo WhatsApp da gráfica.">
                    <Button variant="outline" size="sm" onClick={lembrarCliente} disabled={lembrando}>
                      {lembrando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-1" />} Lembrar o cliente
                    </Button>
                  </Dica>
                )}
              <Dica texto={dicaAcao("/orcamentos", "whatsapp")}><Button variant="outline" size="sm" onClick={enviarWhatsApp} disabled={gerandoLink}>
                <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
              </Button></Dica>
            </>
          )}
          </div>
        </CardContent>
      </Card>
    
      <PDFHistoryCard tipo="orcamento" referencia_id={id} />
    </>
  );
}
