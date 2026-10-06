/**
 * A marca da Bex Print.
 *
 * LOGO PARA FUNDO BRANCO — letras pretas e o X colorido. O dono mandou em
 * 06/10/2026: "esta é a logo da Bex Print, usar ela sempre que for pra algo com
 * fundo branco ou nos PDF com fundo branco". Por isso:
 *   - vai em todo PDF da Bex Print (orçamento, OS, fatura, recibo, 3D) e nas
 *     telas de fundo branco que o cliente vê (o orçamento pelo link);
 *   - nunca em fundo escuro: as letras são pretas e somem;
 *   - documento de PARCEIRO não leva a marca da Bex Print — leva a dele.
 *
 * Mora em /public, e não no armazenamento privado: o PDF é montado no
 * navegador de quem pede, e vendedor e financeiro não leem a pasta `empresa/`
 * do bucket — com a logo de Configurações, o documento deles saía com uma
 * caixa com o nome no lugar da logo. E o cliente, que abre o orçamento sem
 * login, não lê bucket privado nenhum.
 */
export const LOGO_FUNDO_CLARO = "/marca/bex-print-fundo-claro.png";

/** Largura ÷ altura do arquivo (1165 × 533), para reservar o espaço sem esticar. */
export const PROPORCAO_DA_LOGO = 1165 / 533;

/**
 * Endereço completo da logo: o gerador de PDF baixa a imagem pela URL. Fora do
 * navegador (teste, servidor) fica o caminho relativo.
 */
export function urlDaLogoFundoClaro(
  origem: string = typeof window !== "undefined" ? window.location.origin : "",
): string {
  return origem ? new URL(LOGO_FUNDO_CLARO, origem).href : LOGO_FUNDO_CLARO;
}
