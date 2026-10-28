const { app, output } = require('@azure/functions');

// ========================================
// Binding de saída (INSERT na tabela SENTIMENTOS)
// ========================================

const sqlOutput = output.sql({
    commandText: 'dbo.SENTIMENTOS', // nome da tabela
    connectionStringSetting: 'SqlConnectionString'
});

// ========================================
// Queue Function - Consumidor
// ========================================

app.storageQueue('filaSentimentos', {
    queueName: 'fila-sentimentos',
    connection: 'AzureWebJobsStorage',

    extraOutputs: [sqlOutput],

    handler: async (message, context) => {

        context.log('Mensagem recebida da fila:');
        context.log(message);

        const novoRegistro = {
            IdComentario: message.idComentario,
            Comentario: message.comentario,
            Sentimento: message.sentimento
        };

        // Envia para o binding (INSERT automático)
        context.extraOutputs.set(sqlOutput, [novoRegistro]);

        context.log('Registro inserido:', novoRegistro);
    }
});
