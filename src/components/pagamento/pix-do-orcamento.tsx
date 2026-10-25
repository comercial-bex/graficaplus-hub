import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brCodePix, linkDoWhatsapp, mensagemDoPix, TIPOS_DE_CHAVE_PIX, type TipoDeChavePix } from "@/domain/pagamento/pix";
import { IconePix } from "./marcas";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string) => iso.split("-").reverse().join("/");

export type PixRecebido = { valor: number; em: string; lancado?: boolean };

/**
 * Pix do orçamento: monta o copia e cola com o valor, manda ao cliente e deixa marcar que o dinheiro
 * chegou. Marcar NÃO confirma nada no banco: a pessoa conferiu o extrato. Quando o orçamento vira OS,
 * quem pode confirmar pagamento tem o valor lançado como baixa das parcelas (ver a conversão).
 */
export function PixDoOrcamento({
  numero,
  clienteNome,
  clienteTelefone,
  valorSugerido,
  recebido,
  podeEditar,
  gravando,
  onMarcar,
}: {
  numero: number | null;
  clienteNome: string | null;
  clienteTelefone: string | null;
  /** primeira parcela (ou o total, à vista) */
  valorSugerido: number;
  recebido: PixRecebido | null;
  podeEditar: boolean;
  gravando: boolean;
  onMarcar: (marca: PixRecebido | null) => void;
}) {
  const empresa = useQuery({
    queryKey: ["empresa-config"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("empresa_config").select("*").eq("id", true).maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
    staleTime: 5 * 60_000,
  });
  const cfg = empresa.data;
  const chave = typeof cfg?.pix_chave === "string" ? cfg.pix_chave : "";
  const tipo = (typeof cfg?.pix_tipo === "string" ? cfg.pix_tipo : "aleatoria") as TipoDeChavePix;
  const nomeDaEmpresa = String(cfg?.nome ?? cfg?.razao_social ?? "");
  const [texto, setTexto] = useState("");
  const valor = texto.trim() === "" ? valorSugerido : Number(texto.replace(",", ".")) || 0;

  const copiaECola = useMemo(
    () =>
      chave && valor > 0
        ? brCodePix({
            chave,
            valor,
            nome: nomeDaEmpresa || "Bex Print",
            cidade: String(cfg?.cidade ?? "") || "Macapa",
            identificador: numero ? `ORC${numero}` : undefined,
          })
        : "",
    [chave, valor, nomeDaEmpresa, cfg?.cidade, numero],
  );

  async function copiar(textoACopiar: string, aviso: string) {
    try {
      await navigator.clipboard.writeText(textoACopiar);
      toast.success(aviso);
    } catch {
      toast.error("Não consegui copiar. Selecione o texto e copie à mão.");
    }
  }

  if (empresa.isLoading) return <p className="text-xs text-muted-foreground">Carregando o Pix da empresa…</p>;

  return (
    <div className="space-y-3 rounded-xl border border-[#32BCAD]/40 bg-[#32BCAD]/5 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <IconePix className="h-5 w-5 text-[#32BCAD]" /> Pix
      </div>

      {!chave ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/15 p-2 text-xs" role="note">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p>
            A empresa ainda não tem chave Pix cadastrada, então não dá para montar o copia e cola.{" "}
            <Link to="/configuracoes-empresa" className="underline underline-offset-2">
              Cadastrar em Dados da empresa
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Valor deste Pix (R$)</Label>
              <Input inputMode="decimal" value={texto} placeholder={valorSugerido.toFixed(2).replace(".", ",")} onChange={(e) => setTexto(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Chave ({TIPOS_DE_CHAVE_PIX.find((t) => t.valor === tipo)?.rotulo ?? "Pix"})</Label>
              <div className="flex gap-1.5">
                <Input readOnly value={chave} className="font-mono text-xs" aria-label="Chave Pix da empresa" />
                <Button type="button" size="icon" variant="outline" aria-label="Copiar a chave Pix" onClick={() => void copiar(chave, "Chave Pix copiada")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {copiaECola ? (
            <div className="space-y-1">
              <Label className="text-xs">Pix copia e cola (já com o valor)</Label>
              <textarea
                readOnly
                rows={3}
                value={copiaECola}
                aria-label="Pix copia e cola"
                className="w-full resize-none rounded-md border border-input bg-background p-2 font-mono text-[11px] leading-snug"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Informe um valor maior que zero para gerar o copia e cola.</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!copiaECola} onClick={() => void copiar(copiaECola, "Pix copia e cola copiado")}>
              <Copy className="mr-1.5 h-4 w-4" /> Copiar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!copiaECola}
              onClick={() => {
                const mensagem = mensagemDoPix({ cliente: clienteNome, valor, numeroDoOrcamento: numero, copiaECola, empresa: nomeDaEmpresa || null });
                window.open(linkDoWhatsapp(clienteTelefone, mensagem), "_blank", "noopener,noreferrer");
              }}
            >
              <Send className="mr-1.5 h-4 w-4" /> Enviar ao cliente
            </Button>
          </div>
        </>
      )}

      {recebido ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/40 bg-success/10 p-2 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            Pix de {brl(recebido.valor)} recebido em {dataBR(recebido.em)}
          </span>
          <span className="text-xs text-muted-foreground">
            {recebido.lancado ? "Já lançado nas parcelas." : "Entra como baixa das parcelas quando virar OS."}
          </span>
          {podeEditar && !recebido.lancado && (
            <Button type="button" size="sm" variant="ghost" disabled={gravando} onClick={() => onMarcar(null)}>
              <Undo2 className="mr-1.5 h-4 w-4" /> Desmarcar
            </Button>
          )}
        </div>
      ) : (
        podeEditar && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={gravando || valor <= 0}
            onClick={() => onMarcar({ valor, em: new Date().toLocaleDateString("sv-SE") })}
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" /> O Pix chegou: marcar como recebido
          </Button>
        )
      )}
    </div>
  );
}
