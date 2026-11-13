import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BexLogo } from "@/components/bex/BexLogo";
import { BexBackground } from "@/components/bex/BexBackground";

const TITULO = "Política de Privacidade — Bex Print";
const DESCRICAO =
  "Como a Bex Print coleta, usa e protege os dados do cadastro de parceiros, conforme a LGPD, incluindo o uso do Meta Pixel.";
const URL = "https://bexprint.com.br/privacidade";
const WHATSAPP = "https://wa.me/5596984241205";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: TITULO },
      { name: "description", content: DESCRICAO },
      { property: "og:title", content: TITULO },
      { property: "og:description", content: DESCRICAO },
      { property: "og:type", content: "article" },
      { property: "og:url", content: URL },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: URL }],
  }),
  component: PrivacidadePage,
});

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function Zap() {
  return (
    <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="font-medium text-[color:var(--bex-cyan)] underline underline-offset-2">
      WhatsApp (96) 98424-1205
    </a>
  );
}

function PrivacidadePage() {
  return (
    <BexBackground className="min-h-screen p-6">
      <div className="relative mx-auto w-full max-w-3xl py-8">
        <div className="mb-8 flex flex-col items-center">
          <BexLogo size="xl" showTagline />
        </div>
        <article className="space-y-6 rounded-2xl border border-border bg-card/60 p-8 shadow-2xl backdrop-blur-xl">
          <header className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">Política de Privacidade</h1>
            <p className="text-xs text-muted-foreground">Última atualização: 02/11/2026</p>
          </header>

          <Secao titulo="1. Quem é o responsável pelos seus dados">
            <p>
              BEX PRINT GRÁFICA E COMUNICAÇÃO VISUAL LTDA, CNPJ 68.726.406/0001-90, com sede em Macapá/AP, é a
              controladora dos dados pessoais tratados neste site, nos termos da Lei Geral de Proteção de Dados
              (Lei nº 13.709/2018 — LGPD).
            </p>
            <p>Canal para falar sobre seus dados: <Zap />.</p>
          </Secao>

          <Secao titulo="2. Quais dados coletamos">
            <p>No cadastro de parceiro, coletamos:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>nome da empresa;</li>
              <li>CNPJ ou CPF;</li>
              <li>cidade e UF;</li>
              <li>WhatsApp;</li>
              <li>e-mail;</li>
              <li>senha — armazenada de forma criptografada pelo nosso provedor de autenticação; nós não temos acesso a ela.</li>
            </ul>
          </Secao>

          <Secao titulo="3. Para que usamos">
            <ul className="list-disc space-y-1 pl-5">
              <li>criar e operar sua conta de parceiro;</li>
              <li>fazer contato comercial pelo WhatsApp e por e-mail;</li>
              <li>elaborar orçamentos e atender pedidos;</li>
              <li>controlar cashback e créditos da sua conta.</li>
            </ul>
          </Secao>

          <Secao titulo="4. Base legal">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Execução de contrato e procedimentos preliminares</strong> (art. 7º, V, da LGPD): para o
                cadastro e a operação da conta de parceiro.
              </li>
              <li>
                <strong>Legítimo interesse</strong> (art. 7º, IX, da LGPD): para medir os resultados dos nossos anúncios.
              </li>
            </ul>
          </Secao>

          <Secao titulo="5. Cookies e Meta Pixel">
            <p>
              Nas páginas públicas de cadastro de parceiros, usamos o Meta Pixel, ferramenta da Meta Platforms
              (Facebook e Instagram), para medir visitas e cadastros vindos dos nossos anúncios. O Pixel pode usar
              cookies no seu navegador.
            </p>
            <p>
              <strong>Não enviamos</strong> nome, e-mail, telefone ou documento nesses eventos. Registramos apenas a
              origem do cadastro: os parâmetros de campanha do link (UTM) e o identificador de clique do anúncio.
            </p>
            <p>Você pode limitar esse uso de duas formas:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                nas configurações de anúncios da sua conta Meta: <em>Central de Contas → Preferências de anúncios</em>;
              </li>
              <li>bloqueando ou apagando cookies nas configurações do seu navegador.</li>
            </ul>
            <p>As demais páginas desta política e do sistema não carregam o Meta Pixel.</p>
          </Secao>

          <Secao titulo="6. Com quem compartilhamos">
            <ul className="list-disc space-y-1 pl-5">
              <li>provedores de hospedagem e banco de dados que mantêm o sistema funcionando;</li>
              <li>a Meta, apenas com os eventos de medição descritos acima.</li>
            </ul>
            <p><strong>Não vendemos seus dados.</strong></p>
          </Secao>

          <Secao titulo="7. Por quanto tempo guardamos">
            <p>
              Enquanto sua conta de parceiro estiver ativa e, depois disso, pelo prazo exigido por obrigações legais
              e fiscais.
            </p>
          </Secao>

          <Secao titulo="8. Seus direitos">
            <p>Pelo art. 18 da LGPD, você pode pedir a qualquer momento:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>acesso aos seus dados;</li>
              <li>correção de dados incompletos ou desatualizados;</li>
              <li>exclusão dos dados;</li>
              <li>portabilidade;</li>
              <li>revogação do consentimento, quando for o caso;</li>
              <li>informação sobre com quem compartilhamos seus dados.</li>
            </ul>
            <p>Faça seu pedido pelo <Zap />.</p>
          </Secao>

          <Secao titulo="9. Segurança">
            <p>
              Adotamos medidas técnicas e administrativas para proteger seus dados contra acesso não autorizado,
              perda ou alteração, como acesso restrito à equipe e senhas criptografadas.
            </p>
          </Secao>

          <Secao titulo="10. Alterações desta política">
            <p>
              Podemos atualizar esta política. A versão vigente fica sempre nesta página, com a data da última
              atualização no topo.
            </p>
          </Secao>
        </article>
      </div>
    </BexBackground>
  );
}
