const { app, output } = require('@azure/functions');

const {
    TextAnalyticsClient,
    AzureKeyCredential
} = require('@azure/ai-text-analytics');

// ========================================
// Configuração
// ========================================

const URL_COMENTARIOS = 'https://backend-n75y.onrender.com/comentarios';

// Output binding para a fila (mesmo padrão do "Queue Function - Produtor")
const queueOutput = output.storageQueue({
    queueName: 'fila-sentimentos',
    connection: 'AzureWebJobsStorage'
});

// ========================================
// Timer Function - executa a cada 10 segundos
// ========================================

app.timer('timerComentarios', {
    schedule: '*/10 * * * * *',

    extraOutputs: [queueOutput],

    handler: async (myTimer, context) => {

        context.log('Executando a cada 10 segundos');

        try {

            // 1) Obtém um comentário aleatório do end-point
            const resposta = await fetch(URL_COMENTARIOS);
            const dados = await resposta.json(); // { id: 97, comentario: "..." }

            context.log('Comentário recebido:', dados);

            // 2) Analisa o sentimento com o Azure AI Language (cognitive service)
            const client = new TextAnalyticsClient(
                process.env.LANGUAGE_ENDPOINT,
                new AzureKeyCredential(process.env.LANGUAGE_KEY)
            );

            const results = await client.analyzeSentiment(
                [dados.comentario],
                'pt'
            );

            const result = results[0];

            if (result.error) {
                context.error('Erro na análise:', result.error);
                return;
            }

            // A API pode devolver "mixed" (positivo e negativo ao mesmo tempo).
            // Como a atividade pede apenas positive, neutral ou negative,
            // "mixed" é contabilizado como neutral.
            let sentimento = result.sentiment;
            if (sentimento === 'mixed') {
                sentimento = 'neutral';
            }

            const mensagem = {
                idComentario: dados.id,
                comentario: dados.comentario,
                sentimento: sentimento
            };

            // 3) Envia o resultado para a fila
            context.extraOutputs.set(queueOutput, mensagem);

            context.log('Mensagem enviada para fila:', mensagem);

        } catch (err) {
            context.error('Erro:', err.message);
        }
    }
});
