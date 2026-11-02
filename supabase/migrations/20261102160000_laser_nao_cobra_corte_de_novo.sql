-- O corte do acrílico já está no preço (02/11/2026). No teste real, a IA marcou "Corte a laser" como acabamento de um
-- acrílico recortado, porque o roteiro oferecia essa opção.
UPDATE public.produto_ficha f
   SET ia_personalidade = f.ia_personalidade || E'\nO corte já está no preço deste produto: nunca marque Corte a laser como acabamento.',
       ia_perguntas = replace(f.ia_perguntas, E'- Qual acabamento? Opções: Corte a laser (CNC Laser)\n', '')
  FROM public.produtos p
 WHERE p.id = f.produto_id AND p.sku IN ('ACR-VIR2', 'ACR-VIR3', 'ACR-ESP2', 'QUA-ACR');
