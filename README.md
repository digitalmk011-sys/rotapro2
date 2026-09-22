# RotaPro MVP 0.8

Versão focada na importação direta de listas de logística.

## Formato suportado

O RotaPro reconhece diretamente colunas como:

- `AT ID` → identificação da entrega
- `Sequence` → sequência original
- `Stop` → número da parada
- `SPX TN` → código de transporte
- `Destination Address` → endereço
- `Bairro` → bairro
- `City` → cidade
- `Zipcode/Postal code` → CEP
- `Latitude` → latitude
- `Longitude` → longitude

Também mantém compatibilidade com colunas genéricas como Cliente, Endereço, Telefone e Observação.

## Importação

O importador aceita CSV separado por `;`, `,`, TAB ou `|`, com UTF-8 ou Windows-1252.

Quando Latitude e Longitude existem na planilha, o aplicativo usa essas coordenadas diretamente e evita geocodificação desnecessária.

## Exemplo

Use `exemplo_entregas.csv` incluído neste projeto.
