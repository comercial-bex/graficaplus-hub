import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Download, ImagePlus, Palette, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { mensagemErro } from "@/lib/erros";
import { baixarArquivo, renderPDFBlob } from "@/lib/pdf/generate";
import {
  BUCKET_MARCAS,
  carregarPainel,
  CHAVE_PAINEL,
  enviarLogo,
  salvarMarca,
  urlDoLogo,
} from "@/lib/parceiro-api";
import { formatarDocumento, formatarTelefone, rotuloDoDocumento } from "@/domain/documentos";
import { DicaIcone } from "@/components/bex/Dica";
import type { MarcaDoParceiro } from "@/domain/parceiros/painel";
import { CONDICOES_PADRAO, COR_PADRAO_DA_MARCA, propsDoOrcamentoDoParceiro } from "@/domain/parceiros/pdf";

export const Route = createFileRoute("/parceiro/marca")({
  component: MarcaDoParceiroPage,
});

const VAZIA: MarcaDoParceiro = {
  nome: "",
  documento: "",
  telefone: "",
  email: "",
  endereco: "",
  cidade: "",
  estado: "",
  cor: COR_PADRAO_DA_MARCA,
  logo_path: null,
  rodape: "",
};

/**
 * Os dados que saem no cabeçalho do orçamento do parceiro.
 *
 * A prévia imita o cabeçalho do PDF, e o botão de exemplo gera o PDF de verdade:
 * a pessoa confere o logo e as cores antes de mandar o primeiro orçamento para um
 * cliente, e não depois.
 */
function MarcaDoParceiroPage() {
  const qc = useQueryClient();
  const { data: painel } = useQuery({ queryKey: CHAVE_PAINEL, queryFn: carregarPainel, staleTime: 60_000 });
  const [marca, setMarca] = useState<MarcaDoParceiro>(VAZIA);
  const [original, setOriginal] = useState<MarcaDoParceiro>(VAZIA);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  // Recarrega do banco só sem edição pendente: um refetch não apaga o que foi digitado.
  useEffect(() => {
    if (!painel) return;
    if (JSON.stringify(marca) !== JSON.stringify(original)) return;
    const m = { ...VAZIA, ...limpar(painel.marca) };
    setMarca(m);
    setOriginal(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painel]);

  useEffect(() => {
    let vivo = true;
    urlDoLogo(marca.logo_path).then((url) => vivo && setLogoUrl(url));
    return () => {
      vivo = false;
    };
  }, [marca.logo_path]);

  if (!painel) return null;

  const sujo = JSON.stringify(marca) !== JSON.stringify(original);
  const mudar = (parcial: Partial<MarcaDoParceiro>) => setMarca((m) => ({ ...m, ...parcial }));

  async function escolherLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !painel) return;
    setEnviandoLogo(true);
    try {
      const caminho = await enviarLogo(painel.parceiro.id, f);
      mudar({ logo_path: caminho });
      toast.success("Logo enviado. Salve para usar nos orçamentos.");
    } catch (erro) {
      toast.error(mensagemErro(erro, "Não foi possível enviar o logo."));
    } finally {
      setEnviandoLogo(false);
    }
  }

  async function salvar() {
    setSalvando(true);
    try {
      await salvarMarca({
        ...marca,
        documento: marca.documento ? formatarDocumento(marca.documento) : "",
        estado: (marca.estado ?? "").toUpperCase(),
      });
      // o logo antigo fica sem uso: apaga para não acumular arquivo órfão
      if (original.logo_path && original.logo_path !== marca.logo_path) {
        await supabase.storage.from(BUCKET_MARCAS).remove([original.logo_path]);
      }
      setOriginal(marca);
      await qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
      toast.success("Marca salva — os próximos PDFs já saem assim.");
    } catch (erro) {
      toast.error(mensagemErro(erro, "Não foi possível salvar a marca."));
    } finally {
      setSalvando(false);
    }
  }

  async function pdfDeExemplo() {
    if (!painel) return;
    setGerando(true);
    try {
      const props = propsDoOrcamentoDoParceiro({
        orcamento: {
          numero: 1,
          titulo: "Exemplo",
          cliente_nome: "Cliente de exemplo",
          cliente_telefone: null,
          cliente_email: null,
          cliente_documento: null,
          observacoes: null,
          validade_dias: 7,
          created_at: new Date().toISOString(),
        },
        itens: [
          { produto_id: null, descricao: "Banner em lona com bastão e cordão", unidade: "m²", largura: 1, altura: 1.5, quantidade: 2, preco_venda_unidade: 85, acabamento: "Bastão" },
          { produto_id: null, descricao: "Adesivo de vitrine", unidade: "m²", largura: 2, altura: 0.8, quantidade: 1, preco_venda_unidade: 95, acabamento: "Refile" },
          { produto_id: null, descricao: "Instalação", unidade: "un", largura: null, altura: null, quantidade: 1, preco_venda_unidade: 120, acabamento: null },
        ],
        catalogo: new Map(),
        marca,
        nomeDoParceiro: painel.parceiro.nome,
        logoUrl,
      });
      baixarArquivo(await renderPDFBlob(props), "Exemplo-de-orcamento.pdf");
    } catch (erro) {
      toast.error(mensagemErro(erro, "Não foi possível gerar o exemplo."));
    } finally {
      setGerando(false);
    }
  }

  const cor = /^#[0-9a-fA-F]{6}$/.test(marca.cor) ? marca.cor : COR_PADRAO_DA_MARCA;
  const nomeExibido = (marca.nome ?? "").trim() || painel.parceiro.nome;

  return (
    <div className="space-y-5 pb-16">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Palette className="h-6 w-6 text-[color:var(--bex-magenta)]" />
          Minha marca
        </h1>
        <p className="text-sm text-muted-foreground">
          É o que o seu cliente vê no orçamento. O nome da gráfica não aparece em lugar nenhum do PDF.
        </p>
      </div>

      {/* Prévia do cabeçalho — fundo branco como no papel */}
      <section aria-label="Prévia do cabeçalho do orçamento" className="overflow-hidden rounded-2xl border border-border bg-white text-neutral-900 shadow-lg">
        <div className="h-2" style={{ background: cor }} />
        <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-1">
            <div className="mb-2 flex h-14 w-40 items-center justify-center overflow-hidden rounded border" style={{ borderColor: cor }}>
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <span className="truncate px-2 text-sm font-bold" style={{ color: cor }}>
                  {nomeExibido}
                </span>
              )}
            </div>
            <p className="truncate text-sm font-bold">{nomeExibido}</p>
            {marca.documento && (
              <p className="text-xs text-neutral-600">
                {rotuloDoDocumento(marca.documento)} {formatarDocumento(marca.documento)}
              </p>
            )}
            {marca.telefone && <p className="text-xs text-neutral-600">{formatarTelefone(marca.telefone)}</p>}
            {(marca.endereco || marca.cidade) && (
              <p className="text-xs text-neutral-600">
                {[marca.endereco, [marca.cidade, marca.estado].filter(Boolean).join("-")].filter(Boolean).join(", ")}
              </p>
            )}
            {marca.email && <p className="text-xs text-neutral-600">{marca.email}</p>}
          </div>
          <div className="sm:border-l sm:border-neutral-200 sm:pl-5">
            <p className="text-lg font-bold" style={{ color: cor }}>
              ORÇAMENTO Nº 1
            </p>
            <p className="text-xs text-neutral-500">Emissão {new Date().toLocaleDateString("pt-BR")}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={arquivo} type="file" accept="image/png,image/jpeg" className="hidden" onChange={escolherLogo} />
          <Button variant="outline" onClick={() => arquivo.current?.click()} disabled={enviandoLogo}>
            <ImagePlus className="mr-1 h-4 w-4" />
            {enviandoLogo ? "Enviando…" : marca.logo_path ? "Trocar logo" : "Enviar logo"}
          </Button>
          {marca.logo_path && (
            <Button variant="ghost" onClick={() => mudar({ logo_path: null })}>
              <Trash2 className="mr-1 h-4 w-4" /> Tirar logo
            </Button>
          )}
          <p className="text-xs text-muted-foreground">PNG ou JPG, até 2 MB. Fundo transparente fica melhor.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Campo id="m-nome" rotulo="Nome da marca">
            <Input id="m-nome" value={marca.nome ?? ""} placeholder={painel.parceiro.nome} onChange={(e) => mudar({ nome: e.target.value })} />
          </Campo>
          <Campo id="m-doc" rotulo="CPF ou CNPJ">
            <Input id="m-doc" inputMode="numeric" value={marca.documento ?? ""} onChange={(e) => mudar({ documento: e.target.value })} />
          </Campo>
          <Campo id="m-tel" rotulo="Telefone / WhatsApp">
            <Input id="m-tel" inputMode="tel" value={marca.telefone ?? ""} onChange={(e) => mudar({ telefone: e.target.value })} />
          </Campo>
          <Campo id="m-email" rotulo="E-mail">
            <Input id="m-email" type="email" value={marca.email ?? ""} onChange={(e) => mudar({ email: e.target.value })} />
          </Campo>
          <Campo id="m-end" rotulo="Endereço" className="md:col-span-2">
            <Input id="m-end" value={marca.endereco ?? ""} onChange={(e) => mudar({ endereco: e.target.value })} />
          </Campo>
          <Campo id="m-cidade" rotulo="Cidade">
            <Input id="m-cidade" value={marca.cidade ?? ""} onChange={(e) => mudar({ cidade: e.target.value })} />
          </Campo>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Campo id="m-uf" rotulo="UF">
              <Input id="m-uf" maxLength={2} value={marca.estado ?? ""} onChange={(e) => mudar({ estado: e.target.value.toUpperCase() })} />
            </Campo>
            <Campo id="m-cor" rotulo="Cor da marca">
              <input
                id="m-cor"
                type="color"
                value={cor}
                onChange={(e) => mudar({ cor: e.target.value })}
                className="h-10 w-16 cursor-pointer rounded-md border border-input bg-background p-1"
              />
            </Campo>
          </div>
          <Campo id="m-rodape" rotulo="Condições que saem no orçamento" className="md:col-span-2">
            <Textarea
              id="m-rodape"
              rows={3}
              value={marca.rodape ?? ""}
              placeholder={CONDICOES_PADRAO}
              onChange={(e) => mudar({ rodape: e.target.value })}
            />
          </Campo>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={pdfDeExemplo} disabled={gerando}>
            <Download className="mr-1 h-4 w-4" />
            {gerando ? "Gerando…" : "Baixar PDF de exemplo"}
          </Button>
          <Button onClick={salvar} disabled={!sujo || salvando}>
            <Save className="mr-1 h-4 w-4" />
            {salvando ? "Salvando…" : "Salvar marca"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function limpar(m: MarcaDoParceiro): MarcaDoParceiro {
  return {
    nome: m.nome ?? "",
    documento: m.documento ?? "",
    telefone: m.telefone ?? "",
    email: m.email ?? "",
    endereco: m.endereco ?? "",
    cidade: m.cidade ?? "",
    estado: m.estado ?? "",
    cor: m.cor || COR_PADRAO_DA_MARCA,
    logo_path: m.logo_path ?? null,
    rodape: m.rodape ?? "",
  };
}

const AJUDA: Record<string, string> = {
  "m-nome": "O nome que aparece no cabeçalho do orçamento do seu cliente. Deixe em branco para usar o nome do seu cadastro.",
  "m-doc": "Sai impresso como CPF ou CNPJ conforme o número. Serve para o seu cliente saber de quem é o orçamento.",
  "m-tel": "Telefone que o seu cliente vai usar para falar com VOCÊ.",
  "m-email": "E-mail que sai no documento. Não é o e-mail de login.",
  "m-uf": "Sigla do estado, duas letras.",
  "m-cor": "Cor da faixa e dos títulos do PDF. Use a cor da sua marca.",
  "m-rodape": "Texto que sai no fim do orçamento: prazo, forma de pagamento, condições. Se deixar vazio, entra um texto neutro.",
};

function Campo({
  id,
  rotulo,
  className,
  children,
}: {
  id: string;
  rotulo: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className ? `space-y-1.5 ${className}` : "space-y-1.5"}>
      <Label htmlFor={id} className="flex items-center gap-1 text-xs text-muted-foreground">
        {rotulo}
        <DicaIcone texto={AJUDA[id]} rotulo={rotulo} />
      </Label>
      {children}
    </div>
  );
}
