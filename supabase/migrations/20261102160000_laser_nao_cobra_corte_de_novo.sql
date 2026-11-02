-- O corte do acrílico já está no preço (02/11/2026). No teste real, a IA marcou "Corte a laser" como acabamento de um
-- acrílico recortado, porque o roteiro oferecia essa opção.
UPDATE public.produto_ficha f
   SET ia_personalidade = f.ia_personalidade || E'\nO corte já está no preço deste produto: nunca marque Corte a laser como acabamento.',
       ia_perguntas = replace(f.ia_perguntas, E'- Qual acabamento? Opções: Corte a laser (CNC Laser)\n', '')
  FROM public.produtos p
 WHERE p.id = f.produto_id AND p.sku IN ('ACR-VIR2', 'ACR-VIR3', 'ACR-ESP2', 'QUA-ACR');

-- Chaveiro e gravação: tamanhos para sugerir quando o cliente não sabe a medida.
UPDATE public.produto_ficha f
   SET ia_como_medir = E'## Perguntar sempre\n- Quantas unidades? O preço muda por faixa de quantidade.\n- Qual o tamanho do chaveiro?\n\n## Se o cliente não souber\nSugira 3 x 3 cm (pequeno), 5 x 5 cm (médio) ou 7 x 7 cm (grande). Se o tamanho mudar o preço, avise quem atende.'
  FROM public.produtos p WHERE p.id = f.produto_id AND p.sku = 'BRI-CHA';
UPDATE public.produto_ficha f
   SET ia_como_medir = E'## Perguntar sempre\n- Quantas unidades?\n- O que vai gravado: logo, nome ou frase?\n- Qual o tamanho da gravação, em cm?\n\n## Se o cliente não souber\nSugira de 3 x 3 cm a 5 x 5 cm para um logo discreto, e até 8 x 5 cm na frente de um copo. A área máxima é de 20 x 20 cm por face.'
  FROM public.produtos p WHERE p.id = f.produto_id AND p.sku IN ('BRI-CPT500', 'BRI-CUIA380', 'BRI-KC3', 'BRI-KC3B', 'BRI-KCL2');
