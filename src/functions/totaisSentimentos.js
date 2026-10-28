const { app, input } = require('@azure/functions');

// ========================================
// Binding de entrada (consulta SQL)
// COUNT(CASE ...) devolve 0 quando não há registros
// ========================================

const sqlInput = input.sql({
    commandText: `
        SELECT
            COUNT(CASE WHEN Sentimento = 'positive' THEN 1 END) AS positive,
            COUNT(CASE WHEN Sentimento = 'neutral'  THEN 1 END) AS neutral,
            COUNT(CASE WHEN Sentimento = 'negative' THEN 1 END) AS negative
        FROM dbo.SENTIMENTOS
    `,
    commandType: 'Text',
    connectionStringSetting: 'SqlConnectionString'
});

// ========================================
// HTTP Function - totais de sentimentos
// GET https://<HOSTNAME>/api/sentimentos
// ========================================

app.http('totaisSentimentos', {
    methods: ['GET'],
    route: 'sentimentos',
    authLevel: 'anonymous',

    extraInputs: [sqlInput],

    handler: async (request, context) => {

        context.log('Buscando totais de sentimentos no banco...');

        // Executa o binding automaticamente
        const resultado = context.extraInputs.get(sqlInput);
        const totais = resultado[0];

        context.log('Resultado: ', totais);

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            jsonBody: {
                positive: totais.positive,
                neutral: totais.neutral,
                negative: totais.negative
            }
        };
    }
});
