import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Briefcase,
  Headset,
  Palette,
  Printer,
  RefreshCw,
  ShieldCheck,
  Truck,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AssistenteEmPassos } from "@/components/bex/assistente-em-passos";
import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cargoSugerido,
  gerarSenhaInicial,
  PASSOS_DO_USUARIO,
  pendenciaDoPassoDoUsuario,
  PERFIS_DO_CADASTRO,
  RESPOSTAS_VAZIAS_DO_USUARIO,
  usuarioDasRespostas,
  type NumeroDoPasso,
  type RespostasDoUsuario,
} from "@/domain/usuarios/novo-usuario-em-passos";
import { criarUsuario } from "@/lib/api/usuarios.functions";
import { mensagemErro } from "@/lib/erros";

const ICONES: Record<string, LucideIcon> = {
  Headset,
  Printer,
  Briefcase,
  Wallet,
  Palette,
  Boxes,
  Truck,
  ShieldCheck,
};

const novaSenha = () => gerarSenhaInicial(crypto.getRandomValues(new Uint32Array(10)));

/**
 * Novo usuário em passos: o perfil primeiro, em cartões, depois nome e e-mail, a senha inicial
 * (gerada, para a pessoa trocar) e a revisão. Só o administrador chega aqui: a função do servidor
 * confere de novo.
 */
export function NovoUsuarioEmPassos({
  aberto,
  onFechar,
  onAbrirCadastroCompleto,
}: {
  aberto: boolean;
  onFechar: () => void;
  onAbrirCadastroCompleto: () => void;
}) {
  const qc = useQueryClient();
  const criar = useServerFn(criarUsuario);
  const [r, setR] = useState<RespostasDoUsuario>(RESPOSTAS_VAZIAS_DO_USUARIO);
  const [passo, setPasso] = useState<NumeroDoPasso>(1);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setR({ ...RESPOSTAS_VAZIAS_DO_USUARIO, senha: novaSenha() });
      setPasso(1);
    }
  }, [aberto]);

  const pendencia = pendenciaDoPassoDoUsuario(passo, r);

  async function salvar() {
    setCriando(true);
    try {
      await criar({ data: usuarioDasRespostas(r) });
      toast.success("Usuário criado");
      qc.invalidateQueries({ queryKey: ["usuarios-admin"] });
      onFechar();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setCriando(false);
    }
  }

  const campo = (id: string, rotulo: string, k: keyof RespostasDoUsuario, extra?: object) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input
        id={id}
        value={r[k] as string}
        onChange={(e) => setR({ ...r, [k]: e.target.value })}
        {...extra}
      />
    </div>
  );

  return (
    <AssistenteEmPassos
      aberto={aberto}
      onFechar={onFechar}
      titulo="Novo usuário em passos"
      passos={PASSOS_DO_USUARIO}
      atual={passo}
      onIr={(n) => setPasso(n as NumeroDoPasso)}
      pendencia={passo === 1 ? null : pendencia}
      semAvancar={false}
      rotuloCriar="Criar usuário"
      criando={criando}
      onCriar={salvar}
      testId="novo-usuario-em-passos"
    >
      {passo === 1 && (
        <div className="space-y-3">
          <GradeDeCartoes rotulo="Perfil de acesso">
            {PERFIS_DO_CADASTRO.map((p) => {
              const Icone = ICONES[p.icone] ?? User;
              return (
                <CartaoDeEscolha
                  key={p.chave}
                  ativo={r.perfil === p.chave}
                  titulo={p.titulo}
                  detalhe={p.detalhe}
                  icone={<Icone className="h-8 w-8 text-muted-foreground" />}
                  onEscolher={() => {
                    setR({ ...r, perfil: r.perfil === p.chave ? "" : p.chave });
                    setPasso(2);
                  }}
                />
              );
            })}
          </GradeDeCartoes>
          <p className="text-sm text-muted-foreground">
            O que cada perfil pode exatamente fica em Equipe e acessos › Permissões. Dá para pular e
            dar o perfil depois.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onFechar();
              onAbrirCadastroCompleto();
            }}
          >
            Cadastro completo
          </Button>
        </div>
      )}

      {passo === 2 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {campo("nu-nome", "Nome *", "nome")}
          {campo("nu-email", "E-mail *", "email", { type: "email", autoComplete: "off" })}
          {campo("nu-tel", "Telefone", "telefone", { inputMode: "tel" })}
          <div className="space-y-1.5">
            <Label htmlFor="nu-cargo">Cargo</Label>
            <Input
              id="nu-cargo"
              value={r.cargo}
              placeholder={cargoSugerido(r.perfil)}
              onChange={(e) => setR({ ...r, cargo: e.target.value })}
            />
          </div>
        </div>
      )}

      {passo === 3 && (
        <div className="space-y-3">
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="nu-senha">Senha inicial</Label>
            <div className="flex gap-2">
              <Input
                id="nu-senha"
                className="font-mono"
                value={r.senha}
                onChange={(e) => setR({ ...r, senha: e.target.value })}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Gerar outra senha"
                onClick={() => setR({ ...r, senha: novaSenha() })}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Passe esta senha à pessoa; ela entra com o e-mail e troca a senha depois. Aparece só
            agora.
          </p>
        </div>
      )}

      {passo === 4 && (
        <dl className="grid gap-x-4 gap-y-1 rounded-lg border p-3 text-sm sm:grid-cols-2">
          <Linha
            rotulo="Perfil"
            valor={
              PERFIS_DO_CADASTRO.find((p) => p.chave === r.perfil)?.titulo ??
              "sem perfil por enquanto"
            }
          />
          <Linha rotulo="Nome" valor={r.nome.trim()} />
          <Linha rotulo="E-mail" valor={r.email.trim()} />
          <Linha rotulo="Telefone" valor={r.telefone.trim() || "não informado"} />
          <Linha
            rotulo="Cargo"
            valor={r.cargo.trim() || cargoSugerido(r.perfil) || "não informado"}
          />
          <Linha rotulo="Senha inicial" valor={r.senha} />
        </dl>
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
