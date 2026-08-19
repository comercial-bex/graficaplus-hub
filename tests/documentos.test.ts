import { test, expect } from "vitest";
import {
  apenasDigitos,
  chaveWhatsApp,
  formatarCEP,
  formatarDocumento,
  formatarTelefone,
  tipoPorTamanho,
  validarCNPJ,
  validarCPF,
  validarDocumento,
} from "../src/domain/documentos";

test("CNPJ válido é aceito com ou sem máscara", () => {
  // CNPJ público usado nos exemplos da BrasilAPI
  expect(validarCNPJ("19131243000197")).toBe(true);
  expect(validarCNPJ("19.131.243/0001-97")).toBe(true);
  // CNPJ da gráfica no orçamento 1059
  expect(validarCNPJ("37.914.628/0001-02")).toBe(true);
});

test("CNPJ com dígito verificador errado é recusado", () => {
  expect(validarCNPJ("19131243000198")).toBe(false);
  expect(validarCNPJ("37.914.628/0001-03")).toBe(false);
});

test("CNPJ com tamanho errado ou repetido é recusado", () => {
  expect(validarCNPJ("1913124300019")).toBe(false);
  expect(validarCNPJ("191312430001977")).toBe(false);
  expect(validarCNPJ("11111111111111")).toBe(false);
  expect(validarCNPJ("00000000000000")).toBe(false);
  expect(validarCNPJ("")).toBe(false);
});

test("CPF válido é aceito com ou sem máscara", () => {
  expect(validarCPF("52998224725")).toBe(true);
  expect(validarCPF("529.982.247-25")).toBe(true);
});

test("CPF com dígito errado ou sequência repetida é recusado", () => {
  expect(validarCPF("52998224726")).toBe(false);
  expect(validarCPF("11111111111")).toBe(false);
  expect(validarCPF("123.456.789-00")).toBe(false);
  expect(validarCPF("")).toBe(false);
});

test("tipo é inferido pelo número de dígitos", () => {
  expect(tipoPorTamanho("529.982.247-25")).toBe("cpf");
  expect(tipoPorTamanho("19.131.243/0001-97")).toBe("cnpj");
  expect(tipoPorTamanho("123")).toBeNull();
});

test("validarDocumento respeita o tipo escolhido", () => {
  // CNPJ válido não passa como CPF, mesmo sendo um documento legítimo
  expect(validarDocumento("19131243000197", "cnpj")).toBe(true);
  expect(validarDocumento("19131243000197", "cpf")).toBe(false);
  expect(validarDocumento("52998224725", "cpf")).toBe(true);
  // sem tipo, decide pelo tamanho
  expect(validarDocumento("52998224725")).toBe(true);
});

test("formatação aplica a máscara certa para cada tipo", () => {
  expect(formatarDocumento("19131243000197")).toBe("19.131.243/0001-97");
  expect(formatarDocumento("52998224725")).toBe("529.982.247-25");
});

test("formatação parcial acompanha a digitação sem quebrar", () => {
  expect(formatarDocumento("191", "cnpj")).toBe("19.1");
  expect(formatarDocumento("19131", "cnpj")).toBe("19.131");
  expect(formatarDocumento("529", "cpf")).toBe("529");
  expect(formatarDocumento("52998", "cpf")).toBe("529.98");
});

test("formatação descarta dígitos além do tamanho do tipo", () => {
  expect(formatarDocumento("191312430001979999", "cnpj")).toBe("19.131.243/0001-97");
  expect(formatarDocumento("5299822472599", "cpf")).toBe("529.982.247-25");
});

test("apenasDigitos limpa qualquer pontuação", () => {
  expect(apenasDigitos("19.131.243/0001-97")).toBe("19131243000197");
  expect(apenasDigitos("(96) 99111-6169")).toBe("96991116169");
});

// Espelha public.normalize_whatsapp_phone. Se as duas divergirem, a tela acha um
// cliente e o banco acha outro — que foi o defeito corrigido em 19/08.
test("mesmo celular escrito de jeitos diferentes vira a mesma chave", () => {
  const esperado = "96991112233";
  expect(chaveWhatsApp("(96) 99111-2233")).toBe(esperado); // com máscara
  expect(chaveWhatsApp("96991112233")).toBe(esperado); // só dígitos
  expect(chaveWhatsApp("5596991112233")).toBe(esperado); // com +55
  expect(chaveWhatsApp("9691112233")).toBe(esperado); // sem o nono dígito
  expect(chaveWhatsApp(" +55 (96) 99111-2233 ")).toBe(esperado);
});

test("fixo não ganha o nono dígito", () => {
  // 3 após o DDD indica fixo; acrescentar o 9 criaria um número inexistente
  expect(chaveWhatsApp("(96) 3222-1010")).toBe("9632221010");
  expect(chaveWhatsApp("5596 3222-1010")).toBe("9632221010");
});

test("celulares diferentes não colidem", () => {
  expect(chaveWhatsApp("(96) 98888-1111")).not.toBe(chaveWhatsApp("(96) 99111-2233"));
});

test("telefone vazio ou sem dígito não vira chave", () => {
  expect(chaveWhatsApp("")).toBeNull();
  expect(chaveWhatsApp(null)).toBeNull();
  expect(chaveWhatsApp(undefined)).toBeNull();
  expect(chaveWhatsApp("sem número")).toBeNull();
});

test("número curto ou estrangeiro é preservado como veio", () => {
  // não inventa DDD nem nono dígito onde a regra brasileira não se aplica
  expect(chaveWhatsApp("3222-1010")).toBe("32221010");
  expect(chaveWhatsApp("+1 415 555 2671")).toBe("14155552671");
});

test("telefone e CEP são formatados como no documento", () => {
  expect(formatarTelefone("96991116169")).toBe("(96) 99111-6169");
  expect(formatarTelefone("9691194660")).toBe("(96) 9119-4660");
  expect(formatarCEP("68240000")).toBe("68240-000");
});
