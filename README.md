# RotaPro MVP 0.7

## Importação CSV aprimorada
A versão 0.7 corrige a importação de listas e aceita arquivos CSV exportados pelo Excel brasileiro.

Recursos:
- seleção de arquivo com qualquer extensão/MIME pelo seletor Android;
- separador automático: `;`, `,`, TAB ou `|`;
- UTF-8 com BOM e fallback Windows-1252;
- campos entre aspas e vírgulas/; dentro do endereço;
- reconhecimento automático de colunas por nome;
- aceita `Cliente`, `Nome`, `Destinatário`, `Endereço`, `Rua`, `Logradouro`, `Telefone`, `Celular`, `Observação`, `Complemento` etc.;
- prévia antes de importar;
- avisos por linha com endereço vazio;
- linhas vazias ignoradas.

Exemplo recomendado para Excel:

```csv
Cliente;Endereço;Telefone;Observação
João;Rua das Flores, 100;44999999999;Casa azul
Maria;Av. Brasil, 250;44988888888;Portaria
Carlos;Rua Paraná, 500;44977777777;Ligar antes
```

## Gerar APK
Abra o diretório `RotaPro` no Android Studio, sincronize o Gradle e use `Build > Build APK(s)`.
