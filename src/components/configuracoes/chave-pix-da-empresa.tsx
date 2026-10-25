import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IconePix } from "@/components/pagamento/marcas";
import { QrCodeDoPix } from "@/components/pagamento/qr-code-do-pix";
import { brCodePix, linkDoWhatsapp } from "@/domain/pagamento/pix";
import { Copy, Send } from "lucide-react";
import { normalizarChavePix, problemaNaChavePix, TIPOS_DE_CHAVE_PIX, type TipoDeChavePix } from "@/domain/pagamento/pix";

/** A chave Pix da empresa: é com ela que o orçamento monta o "Pix copia e cola". */
export function ChavePixDaEmpresa() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const pode = hasPermission("configuracoes.manage");
  const config = useQuery({
    queryKey: ["empresa-config"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("empresa_config").select("*").eq("id", true).maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
  });
  const [tipo, setTipo] = useState<TipoDeChavePix>("cnpj");
  const [chave, setChave] = useState("");
  useEffect(() => {
    if (!config.data) return;
    if (typeof config.data.pix_tipo === "string") setTipo(config.data.pix_tipo as TipoDeChavePix);
    setChave(typeof config.data.pix_chave === "string" ? config.data.pix_chave : "");
  }, [config.data]);

  const normalizada = normalizarChavePix(tipo, chave);
  const problema = chave.trim() ? problemaNaChavePix(tipo, normalizada) : null;

  const salvar = useMutation({
    mutationFn: async () => {
      if (!normalizada) {
        const { error } = await (supabase as any).from("empresa_config").update({ pix_tipo: null, pix_chave: null }).eq("id", true);
        if (error) throw error;
        return;
      }
      const erro = problemaNaChavePix(tipo, normalizada);
      if (erro) throw new Error(erro);
      const { data, error } = await (supabase as any).from("empresa_config").update({ pix_tipo: tipo, pix_chave: normalizada }).eq("id", true).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Seu perfil não pode alterar os dados da empresa.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["empresa-config"] });
      toast.success("Chave Pix salva");
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <IconePix className="h-5 w-5 text-[#32BCAD]" /> Chave Pix da empresa
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          É com esta chave que o orçamento monta o Pix copia e cola, já com o valor. Confira com o banco: se a chave estiver errada, o cliente paga para outra pessoa.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} disabled={!pode} onValueChange={(v) => setTipo(v as TipoDeChavePix)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TIPOS_DE_CHAVE_PIX.map((t) => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Chave</Label>
            <Input value={chave} disabled={!pode} onChange={(e) => setChave(e.target.value)} onBlur={() => setChave(normalizada)} className="font-mono" placeholder="Digite ou cole a chave" />
            {problema && <p className="text-xs text-destructive" role="alert">{problema}</p>}
          </div>
        </div>
        {pode ? (
          <Button size="sm" disabled={salvar.isPending || !!problema} onClick={() => salvar.mutate()}>Salvar a chave</Button>
        ) : (
          <p className="text-xs text-muted-foreground">Só quem gerencia as configurações altera a chave.</p>
        )}

        {/* Teste de R$ 0,01: o jeito de ver, no app do banco, o nome do recebedor e o valor, antes de mandar a um cliente. */}
        {typeof config.data?.pix_chave === "string" && config.data.pix_chave && (
          <TesteDeUmCentavo
            chave={config.data.pix_chave}
            nome={String(config.data.nome ?? config.data.razao_social ?? "Bex Print")}
            cidade={String(config.data.cidade ?? "Macapa")}
            razao={String(config.data.razao_social ?? config.data.nome ?? "")}
          />
        )}
      </CardContent>
    </Card>
  );
}

function TesteDeUmCentavo({ chave, nome, cidade, razao }: { chave: string; nome: string; cidade: string; razao: string }) {
  const codigo = brCodePix({ chave, valor: 0.01, nome, cidade, identificador: "TESTE" });
  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      toast.success("Código de teste copiado");
    } catch {
      toast.error("Não consegui copiar. Selecione o texto e copie à mão.");
    }
  }
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
      <p className="text-sm font-semibold">Teste de R$ 0,01</p>
      <p className="text-xs text-muted-foreground">
        Pague este código no app do banco e confira o recebedor (<strong>{razao}</strong>), o banco e o valor de R$ 0,01 antes de mandar um Pix a cliente. Depois confira o centavo no extrato.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <QrCodeDoPix texto={codigo} tamanho={152} />
        <div className="min-w-0 flex-1 space-y-2">
          <textarea readOnly rows={4} value={codigo} aria-label="Pix copia e cola de teste" className="w-full resize-none rounded-md border border-input bg-background p-2 font-mono text-[11px] leading-snug" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void copiar()}><Copy className="mr-1.5 h-4 w-4" /> Copiar</Button>
            <Button type="button" size="sm" onClick={() => window.open(linkDoWhatsapp(null, `Pix de teste de R$ 0,01 da ${nome}:\n${codigo}`), "_blank", "noopener,noreferrer")}>
              <Send className="mr-1.5 h-4 w-4" /> Mandar para um WhatsApp
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
