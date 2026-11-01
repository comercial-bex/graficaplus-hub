/* eslint-disable @typescript-eslint/no-explicit-any -- payload dinâmico, como o cadastro de antes */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, User, UserX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AssistenteEmPassos } from "@/components/bex/assistente-em-passos";
import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import { CampoDocumento } from "@/components/campo-documento";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  aplicarDadosDaReceita,
  clienteDasRespostas,
  passosDoCliente,
  PASSOS_DO_CLIENTE,
  pendenciaDoPassoDoCliente,
  RESPOSTAS_VAZIAS_DO_CLIENTE,
  type NumeroDoPasso,
  type RespostasDoCliente,
} from "@/domain/clientes/novo-cliente-em-passos";
import { chaveWhatsApp, formatarCEP, recebeWhatsApp } from "@/domain/documentos";
import { mensagemErro } from "@/lib/erros";
import { registrarUso } from "@/lib/uso-de-telas";
import { CampoDeOrigem } from "@/components/cliente/campos-da-ficha";
import { CampoDeTelefoneComPais, SeletorDePais } from "@/components/cliente/campo-de-pais";
import { CampoDeCep } from "@/components/cliente/campo-de-cep";
import { preencherEnderecoDoCep } from "@/domain/clientes/ficha-do-cliente";
import { ehBrasil, rotuloDoPais, trocarDePais } from "@/domain/clientes/paises";

/**
 * Novo cliente em passos: tipo, documento (CNPJ preenche o resto), contato, endereço, responsável
 * e revisão. As regras do cadastro de antes valem aqui: WhatsApp obrigatório que receba mensagem,
 * e o mesmo WhatsApp não entra duas vezes (dito antes do clique, não depois).
 */
export function NovoClienteEmPassos({
  aberto,
  onFechar,
  onAbrirCadastroCompleto,
}: {
  aberto: boolean;
  onFechar: () => void;
  onAbrirCadastroCompleto: () => void;
}) {
  const qc = useQueryClient();
  const [r, setR] = useState<RespostasDoCliente>(RESPOSTAS_VAZIAS_DO_CLIENTE);
  const [passo, setPasso] = useState<NumeroDoPasso>(1);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setR(RESPOSTAS_VAZIAS_DO_CLIENTE);
      setPasso(1);
    }
  }, [aberto]);

  const vendedores = useQuery({
    queryKey: ["vendedores"],
    enabled: aberto,
    queryFn: async () =>
      (await supabase.from("usuarios").select("id, nome").eq("ativo", true).order("nome")).data ??
      [],
  });

  const chave = recebeWhatsApp(r.telefone) ? chaveWhatsApp(r.telefone) : null;
  const jaCadastrado = useQuery({
    queryKey: ["cliente-pelo-whatsapp", chave],
    enabled: aberto && !!chave,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome")
        .eq("telefone_normalizado", chave as string)
        .eq("ativo", true)
        // pai-arbitrario-ok: mira pelo telefone; o mais antigo é o mesmo que o gatilho do banco cita.
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const duplicadoDe = jaCadastrado.data?.nome ?? null;
  const pendencia = pendenciaDoPassoDoCliente(passo, r, duplicadoDe);
  const passos = passosDoCliente(r).map((n) => PASSOS_DO_CLIENTE[n - 1]);

  function escolherTipo(t: "pf" | "pj") {
    setR({ ...r, tipo: t, documento: "" });
    // Cliente de fora não tem CPF nem CNPJ: vai direto para o contato.
    setPasso(ehBrasil(r.pais) ? 2 : 3);
  }

  async function criar() {
    if (criando) return;
    setCriando(true);
    try {
      // O banco confere de novo (gatilho ac_cliente_sem_duplicata_de_whatsapp).
      const { error } = await (supabase as any).from("clientes").insert(clienteDasRespostas(r));
      if (error) {
        toast.error(mensagemErro(error));
        return;
      }
      toast.success("Cliente cadastrado");
      registrarUso("novo-cliente", "concluiu");
      qc.invalidateQueries({ queryKey: ["clientes"] });
      onFechar();
    } finally {
      setCriando(false);
    }
  }

  const campo = (
    id: string,
    rotulo: string,
    chaveDoCampo: keyof RespostasDoCliente,
    extra?: object,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input
        id={id}
        value={r[chaveDoCampo] as string}
        onChange={(e) => setR({ ...r, [chaveDoCampo]: e.target.value })}
        {...extra}
      />
    </div>
  );

  return (
    <AssistenteEmPassos
      aberto={aberto}
      onFechar={onFechar}
      titulo="Novo cliente em passos"
      passos={passos}
      atual={passo}
      onIr={(n) => setPasso(n as NumeroDoPasso)}
      pendencia={passo === 1 ? null : pendencia}
      semAvancar={passo === 1 || passo === 5}
      rotuloCriar="Cadastrar cliente"
      criando={criando}
      onCriar={criar}
      testId="novo-cliente-em-passos"
      tela="novo-cliente"
    >
      {passo === 1 && (
        <div className="space-y-4">
          <div className="max-w-sm">
            <SeletorDePais
              id="nc-pais"
              valor={r.pais}
              onChange={(codigo) => setR((a) => ({ ...a, ...trocarDePais(a, codigo) }))}
            />
          </div>
        <GradeDeCartoes rotulo="Tipo de cliente">
          <CartaoDeEscolha
            ativo={r.tipo === "pj"}
            titulo="Empresa"
            detalhe="pessoa jurídica, com CNPJ"
            icone={<Building2 className="h-8 w-8 text-muted-foreground" />}
            onEscolher={() => escolherTipo("pj")}
          />
          <CartaoDeEscolha
            ativo={r.tipo === "pf"}
            titulo="Pessoa"
            detalhe="pessoa física, com CPF"
            icone={<User className="h-8 w-8 text-muted-foreground" />}
            onEscolher={() => escolherTipo("pf")}
          />
          <CartaoDeEscolha
            ativo={false}
            titulo="Outro"
            detalhe="cadastro completo, com logo"
            onEscolher={() => {
              onFechar();
              onAbrirCadastroCompleto();
            }}
          />
        </GradeDeCartoes>
        </div>
      )}

      {passo === 2 && (
        <div className="space-y-3">
          <div className="max-w-md">
            <CampoDocumento
              tipo={r.tipo === "pf" ? "cpf" : "cnpj"}
              onTipoChange={(t) =>
                setR((a) => ({ ...a, tipo: t === "cnpj" ? "pj" : "pf", documento: "" }))
              }
              valor={r.documento}
              onValorChange={(v) => setR((a) => ({ ...a, documento: v }))}
              onDadosEncontrados={(d) => setR((a) => aplicarDadosDaReceita(a, d))}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {r.tipo === "pf"
              ? "O CPF não tem consulta: dado de pessoa física não é público. Digite os 11 números."
              : "Com o CNPJ completo o sistema consulta a Receita e já preenche nome, endereço e contato."}
          </p>
        </div>
      )}

      {passo === 3 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoDeTelefoneComPais
            id="nc-whats"
            pais={r.pais}
            valor={r.telefone}
            onChange={(telefone) => setR((a) => ({ ...a, telefone }))}
            invalido={!!r.telefone.trim() && !recebeWhatsApp(r.telefone)}
            ajuda="É por ele que sai o orçamento em PDF e o acompanhamento da OS."
          />
          {campo("nc-email", "E-mail", "email", { type: "email" })}
        </div>
      )}

      {passo === 4 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {ehBrasil(r.pais) ? (
            <CampoDeCep
              id="nc-cep"
              valor={r.cep}
              onValorChange={(cep) => setR((a) => ({ ...a, cep }))}
              onEncontrado={(d) => setR((a) => preencherEnderecoDoCep(a, d))}
            />
          ) : (
            campo("nc-cep", "Código postal", "cep", { maxLength: 12 })
          )}
          {campo("nc-endereco", "Endereço", "endereco")}
          {campo("nc-bairro", "Bairro", "bairro")}
          {campo("nc-cidade", "Cidade", "cidade")}
          {campo("nc-estado", "Estado (UF)", "estado", { maxLength: 2 })}
        </div>
      )}

      {passo === 5 && (
        <GradeDeCartoes rotulo="Responsável pelo cliente">
          <CartaoDeEscolha
            ativo={!r.vendedor_id}
            titulo="Sem responsável"
            icone={<UserX className="h-8 w-8 text-muted-foreground" />}
            onEscolher={() => {
              setR({ ...r, vendedor_id: "" });
              setPasso(6);
            }}
          />
          {(vendedores.data ?? []).map((v: any) => (
            <CartaoDeEscolha
              key={v.id}
              ativo={r.vendedor_id === v.id}
              titulo={v.nome}
              icone={<User className="h-8 w-8 text-muted-foreground" />}
              onEscolher={() => {
                setR({ ...r, vendedor_id: v.id });
                setPasso(6);
              }}
            />
          ))}
        </GradeDeCartoes>
      )}

      {passo === 6 && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("nc-nome", "Nome fantasia *", "nome", { maxLength: 200 })}
            {r.tipo === "pj" &&
              campo("nc-razao", "Razão social", "razao_social", { maxLength: 200 })}
          </div>
          <CampoDeOrigem
            valor={r.origem}
            onChange={(origem) => setR((atual) => ({ ...atual, origem }))}
          />
          <div className="space-y-1.5">
            <Label htmlFor="nc-obs">Observações</Label>
            <Textarea
              id="nc-obs"
              rows={2}
              value={r.observacoes}
              onChange={(e) => setR({ ...r, observacoes: e.target.value })}
            />
          </div>
          <dl className="grid gap-x-4 gap-y-1 rounded-lg border p-3 text-sm sm:grid-cols-2">
            <Linha rotulo="País" valor={rotuloDoPais(r.pais)} />
            <Linha rotulo="Tipo" valor={r.tipo === "pf" ? "Pessoa física" : "Empresa"} />
            {ehBrasil(r.pais) && (
              <Linha rotulo="Documento" valor={r.documento.trim() || "não informado"} />
            )}
            <Linha rotulo="WhatsApp" valor={r.telefone.trim()} />
            <Linha rotulo="E-mail" valor={r.email.trim() || "não informado"} />
            <Linha
              rotulo="Cidade"
              valor={[r.cidade, r.estado].filter(Boolean).join(" / ") || "não informada"}
            />
            <Linha rotulo="Origem" valor={r.origem.trim() || "não informada"} />
            <Linha
              rotulo="Responsável"
              valor={
                (vendedores.data ?? []).find((v: any) => v.id === r.vendedor_id)?.nome ??
                "sem responsável"
              }
            />
          </dl>
        </div>
      )}
    </AssistenteEmPassos>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-right font-medium">{valor}</dd>
    </div>
  );
}
