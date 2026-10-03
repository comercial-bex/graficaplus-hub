import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { dicaTela } from "@/lib/dicas";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { MeusDadosCard } from "@/components/configuracoes/meus-dados-card";
import { SenhaCard } from "@/components/configuracoes/senha-card";
import { EmpresaSecao } from "@/components/configuracoes/empresa-secao";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({ meta: [{ title: "Meu perfil — BEX PRINT OS" }] }),
  component: ConfiguracoesPage,
});

/**
 * /configuracoes — "Meu perfil", de qualquer pessoa logada.
 *
 * Era uma tela de 34 linhas que prometia "seu perfil e preferências", mostrava
 * só e-mail e papéis, sem ação nenhuma — e exigia configuracoes.manage, então
 * só o admin via o próprio perfil. Agora cada um troca o nome, o telefone, a
 * foto e a senha. A parte da empresa continua só de quem tem
 * configuracoes.manage.
 *
 * PREFERÊNCIAS: não há seção, de propósito. Em 02/10/2026 o sistema não lia
 * nenhuma preferência por pessoa — nenhuma tabela ou coluna no banco, e no
 * navegador só a dispensa do convite de instalar (que o menu já reabre) e o
 * último preset do orçamento 3D (que a própria tela grava). Botão de
 * preferência que nada lê seria o mesmo "finge que fez" que esta tela tinha.
 */
function ConfiguracoesPage() {
  const { hasPermission } = useAuth();
  const administraEmpresa = hasPermission("configuracoes.manage");

  return (
    <div className="max-w-3xl space-y-6">
      <SectionHeader
        ajuda={dicaTela("/configuracoes")}
        breadcrumb="Conta"
        title="Meu perfil"
        description={
          administraEmpresa
            ? "Seu nome, telefone, foto e senha — e, mais abaixo, os dados da empresa e os parâmetros da casa."
            : "Seu nome, telefone, foto e senha."
        }
        className="mb-0"
      />
      <MeusDadosCard />
      <SenhaCard />
      {administraEmpresa && <EmpresaSecao />}
    </div>
  );
}
