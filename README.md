# AV-ICL-02 - Azure

Atividade de Infraestrutura Cloud: análise de sentimento dos comentários de clientes usando Azure Functions.

Endpoint com os totais registrados no banco:

https://app-sentimentos-1793230304.azurewebsites.net/api/sentimentos

## Como funciona

1. A função `timerComentarios` roda a cada 10 segundos, pega um comentário em `https://backend-n75y.onrender.com/comentarios` e manda o texto para o Azure AI Language (cognitive service) analisar.
2. O resultado (positive, neutral ou negative) vai para a fila `fila-sentimentos`.
3. A função `filaSentimentos` é disparada quando chega mensagem na fila e grava o registro na tabela `SENTIMENTOS` do SQL Server.
4. A função `totaisSentimentos` (HTTP) consulta o banco e devolve os totais, por exemplo `{ "positive": 2, "neutral": 0, "negative": 2 }`.

Os códigos estão em `src/functions/` e o SQL da tabela em `sql/criar_tabela.sql`.

Obs.: às vezes a API devolve `mixed` (comentário com parte boa e parte ruim). Como a atividade pede só três categorias, contei esses casos como `neutral`.

## Comandos executados na Azure

Rodei tudo pelo Azure Cloud Shell (Bash), que já vem logado na conta, então não precisei do `az login`.

### Região

A minha assinatura Azure for Students não deixa criar recursos em `brazilsouth`. Conferi as regiões liberadas e usei `canadacentral`:

```bash
az policy assignment list --query "[].parameters.listOfAllowedLocations.value[]" -o tsv

export LOCATION=canadacentral
export AZURE_CORE_ONLY_SHOW_ERRORS=true
```

### Variáveis e grupo de recursos

```bash
export RESOURCE_GROUP=rg-sentimentos
export STORAGE_NAME=stf$(date +%s)
export FUNCTION_APP_NAME=app-sentimentos-$(date +%s)
export LANGUAGE_NAME=language-sentimentos-$(date +%s)
export SQL_SERVER=sqlsentimentos$(date +%s)
export SQL_DB=db
export SQL_USER=adminuser
export SQL_PASSWORD='<SUA_SENHA>'

az group create --name $RESOURCE_GROUP --location $LOCATION

az provider register --namespace Microsoft.CognitiveServices
az provider register --namespace Microsoft.Sql
az provider register --namespace Microsoft.Web
az provider register --namespace Microsoft.Storage
```

A senha real eu tirei daqui por segurança. Usei uma senha só com letras e números porque o `$` dentro da senha é interpretado pelo bash.

### Language (análise de sentimento)

```bash
az cognitiveservices account create \
  --name $LANGUAGE_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --kind TextAnalytics \
  --sku S \
  --yes

export LANGUAGE_ENDPOINT=$(az cognitiveservices account show \
  --name $LANGUAGE_NAME \
  --resource-group $RESOURCE_GROUP \
  --query properties.endpoint \
  -o tsv)

export LANGUAGE_KEY=$(az cognitiveservices account keys list \
  --name $LANGUAGE_NAME \
  --resource-group $RESOURCE_GROUP \
  --query key1 \
  -o tsv)
```

### Storage, fila e Function App

```bash
az storage account create \
  --name $STORAGE_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS

export AZURE_STORAGE_CONNECTION_STRING=$(
  az storage account show-connection-string \
    --name "$STORAGE_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query connectionString \
    --output tsv
)

az storage queue create \
  --name fila-sentimentos \
  --account-name $STORAGE_NAME \
  --connection-string $AZURE_STORAGE_CONNECTION_STRING

az functionapp create \
  --resource-group $RESOURCE_GROUP \
  --consumption-plan-location $LOCATION \
  --runtime node \
  --functions-version 4 \
  --name $FUNCTION_APP_NAME \
  --storage-account $STORAGE_NAME
```

### Banco SQL Server

```bash
az sql server create \
  --name $SQL_SERVER \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --admin-user $SQL_USER \
  --admin-password "$SQL_PASSWORD"

az sql server firewall-rule create \
  --resource-group $RESOURCE_GROUP \
  --server $SQL_SERVER \
  --name AllowMyIP \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 255.255.255.255

az sql db create \
  --resource-group $RESOURCE_GROUP \
  --server $SQL_SERVER \
  --name $SQL_DB \
  --service-objective Basic
```

Para criar a tabela baixei o sqlcmd numa pasta separada (para não ir junto no zip da publicação):

```bash
mkdir -p ~/tools && cd ~/tools
wget https://github.com/microsoft/go-sqlcmd/releases/download/v1.10.0/sqlcmd-linux-amd64.tar.bz2
tar -xf sqlcmd-linux-amd64.tar.bz2
cd ~/av-icl-02-azure

~/tools/sqlcmd -S $SQL_SERVER.database.windows.net -d $SQL_DB -U $SQL_USER -P "$SQL_PASSWORD" \
  -Q "CREATE TABLE SENTIMENTOS (Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY, IdComentario INT NULL, Comentario NVARCHAR(1000) NULL, Sentimento NVARCHAR(20) NOT NULL); SELECT name FROM sys.tables;"
```

### Configurações da Function App

Chave do Language e string de conexão do banco (o `-o none` é só para não imprimir as chaves na tela):

```bash
az functionapp config appsettings set \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --settings LANGUAGE_ENDPOINT=$LANGUAGE_ENDPOINT LANGUAGE_KEY=$LANGUAGE_KEY \
  -o none

az functionapp config appsettings set \
  --name $FUNCTION_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --settings SqlConnectionString="Server=tcp:$SQL_SERVER.database.windows.net,1433;Initial Catalog=$SQL_DB;User ID=$SQL_USER;Password=$SQL_PASSWORD;Encrypt=True;" \
  -o none
```

### Publicação

```bash
npm install

zip -r function.zip . -x "node_modules/.cache/*" ".git/*"

az functionapp deployment source config-zip \
  --resource-group $RESOURCE_GROUP \
  --name $FUNCTION_APP_NAME \
  --src function.zip
```

### Teste

```bash
az functionapp function list --resource-group $RESOURCE_GROUP --name $FUNCTION_APP_NAME --query "[].name" -o tsv

HOSTNAME=$(az functionapp show \
  --resource-group $RESOURCE_GROUP \
  --name $FUNCTION_APP_NAME \
  --query defaultHostName \
  --output tsv)

echo $HOSTNAME

curl "https://$HOSTNAME/api/sentimentos"
```

Primeira resposta que recebi: `{"positive":2,"neutral":0,"negative":2}`. Depois disso os números vão aumentando conforme o timer roda.

Para conferir direto no banco:

```bash
~/tools/sqlcmd -S $SQL_SERVER.database.windows.net -d $SQL_DB -U $SQL_USER -P "$SQL_PASSWORD" \
  -Q "SELECT Sentimento, COUNT(*) AS Total FROM SENTIMENTOS GROUP BY Sentimento;"
```

## Para apagar tudo depois

```bash
az group delete --name $RESOURCE_GROUP --yes --no-wait
```
