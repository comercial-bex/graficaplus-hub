import { AVISO_VALOR_NO_TEXTO, textoTemValorEmReais } from "@/domain/custos/valor-no-texto";

/**
 * Aparece embaixo de um campo de texto livre quando alguém digita "R$" nele. Não bloqueia o salvamento: avisa
 * onde o valor deve ir. Letra de 16 px na cor do texto (contraste de 4,5 para 1 ou mais nos dois temas), sem
 * `title` e sem a cor principal como cor de letra.
 */
export function AvisoDeValorNoTexto({ texto }: { texto: string | null | undefined }) {
  if (!textoTemValorEmReais(texto)) return null;
  return (
    <p
      role="status"
      data-aviso-valor-no-texto=""
      className="rounded-md border border-warning/50 bg-warning/15 p-3 text-base text-foreground"
    >
      {AVISO_VALOR_NO_TEXTO}
    </p>
  );
}
