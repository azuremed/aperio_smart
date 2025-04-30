require('dotenv').config(); // Carrega as variáveis do .env
const HL7 = require('hl7-standard'); // Importa a biblioteca HL7
const express = require('express');
const sql = require('mssql');
const { format } = require('date-fns');
const app = express(); // Inicializa o Express
const port = process.env.APP_PORT; // Porta para o servidor
const { randomUUID } = require('crypto');


// Middleware para processar JSON
app.use(express.json());

// Configuração da conexão com o MSSQL
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  schema: process.env.DB_SCHEMA,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true', // Converte para booleano
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true' // Converte para booleano
  }
};

// Função para buscar dados pelo id_amostra
async function fetchHL7(hl7Message) {
  let pool;
  try {
    // Conecta ao banco de dados
    pool = await sql.connect(config);
  } catch (err) {
    console.error('Erro ao conectar ao banco de dados MSSQL:', err);
    throw new Error('Erro de conexão com o banco de dados MSSQL.');
  }

  try {
    const now = new Date();
    const formattedDate = format(now, 'yyyyMMddHHmmss');

    let hl7 = new HL7(hl7Message, {
      fieldSeparator: '|',
      componentSeparator: '^',
      repetitionSeparator: '~',
      escapeCharacter: '\\',
      subcomponentSeparator: '&',
      lineEnding: '\r',
    });
    hl7.transform();

    console.log('HL7 transformado');

    // Capturando o ID da amostra
    let id_amostra = hl7.get('OBR.4');

    // Prepara e executa a query com o parâmetro
    const result = await pool
      .request()
      .input('id', sql.VarChar, id_amostra) // Substitui o parâmetro na query
      .query(
        `SELECT DISTINCT
            pac_reg,
            pac_nome,
            pac_sexo,
            pac_nasc,
            psv_nome,
            psv_cod,
            psv_crm,
            psv_uf,
            osm_serie,
            osm_num,
            smm_cod_amostra,
            smm_dthr_coleta
        FROM SMM
        INNER JOIN osm ON smm.SMM_OSM = osm.osm_num AND smm.SMM_OSM_SERIE = osm.osm_serie
        INNER JOIN psv ON osm.OSM_MREQ = psv.PSV_COD
        INNER JOIN pac ON osm.osm_pac = pac.pac_reg
        WHERE smm_cod_amostra = @id`
      );

    // Fecha a conexão e pega o primeiro registro
    let record = result.recordset[0];

    // Verifica se o registro existe
    if (!record) {
      throw new Error('Nenhum registro encontrado para o ID fornecido.');
    }

    // Garante que os campos não sejam nulos ou undefined
    let patientName = record.pac_nome?.trim() ?? '';
    let patientNameSplited = patientName.split(' ');

    let doctorName = record.psv_nome?.trim() ?? '';
    let doctorNameSplited = doctorName.split(' ');

    let doctorCRM = record.psv_uf + record.psv_crm ?? '';

    let patientGender = record.pac_sexo ?? 'U'; // 'U' para desconhecido (Unknown)

    for (let segment of hl7.getSegments()) {
      if (segment.type === 'ORC') hl7.deleteSegment(segment);
      if (segment.type === 'OBR') hl7.deleteSegment(segment);
      if (segment.type === 'OBX') hl7.deleteSegment(segment);
      if (segment.type === 'PID') hl7.deleteSegment(segment);
      if (segment.type === 'PV1') hl7.deleteSegment(segment);
      if (segment.type === 'SAC') hl7.deleteSegment(segment);
      if (segment.type === 'SPM') hl7.deleteSegment(segment);
    }
    console.log('Segmentos deletados');
    
    hl7.set('MSH.7.1', formattedDate);
    hl7.set('MSH.9.1', 'OML');
    hl7.set('MSH.9.2', 'O21');
    hl7.set('MSH.10',randomUUID());

    hl7.createSegment('PID');
    hl7.createSegment('PV1');
    hl7.createSegment('ORC');
    hl7.createSegment('SAC');
    hl7.createSegment('SPM');
    hl7.createSegment('OBR');

    // Configura os segmentos HL7
    hl7.set('PID.3.1', record.pac_reg?.toString() ?? '');
    hl7.set('PID.5.1', patientNameSplited[patientNameSplited.length - 1] ?? '');
    hl7.set('PID.5.2', patientNameSplited[0] ?? '');
    hl7.set('PID.7', record.pac_nasc ? format(record.pac_nasc, 'yyyyMMdd') : '');
    hl7.set('PID.8', patientGender);
    hl7.set('PID.23', 'U');
    
    hl7.set('PV1.7.1', doctorCRM ?? '');
    hl7.set('PV1.7.2', doctorNameSplited[doctorNameSplited.length - 1] ?? '');
    hl7.set('PV1.7.3', doctorNameSplited[0] ?? '');
    hl7.set('PV1.7.6', 'Dr');

    hl7.set('ORC.1', 'NW');
    
    hl7.set('SAC.1', record.smm_cod_amostra?.toString() ?? '');

    hl7.set('SPM.2.1', record.smm_cod_amostra?.toString() ?? '');
    hl7.set('SPM.17.1', record.smm_dthr_coleta ? format(record.smm_dthr_coleta, 'yyyyMMddHHmmss') : '');
    hl7.set('SPM.18.1', record.smm_dthr_coleta ? format(record.smm_dthr_coleta, 'yyyyMMddHHmmss') : '');

    hl7.set('OBR.1', 1);
    hl7.set('OBR.4', record.smm_cod_amostra?.toString() ?? '');

    let response = await hl7.build();
    return response; // Retorna os dados encontrados
  } catch (err) {
    console.error('Erro ao processar ou transformar a mensagem HL7:', err);
    throw new Error('Erro ao processar ou transformar a mensagem HL7.');
  } finally {
    // Fecha a conexão com o banco de dados
    if (pool) {
      await pool.close();
    }
  }
}

// Função para testar a conexão com o banco de dados
async function testDatabaseConnection() {
  try {
    const pool = await sql.connect(config);
    console.log('Conexão com o banco de dados bem-sucedida!');
    await pool.close(); // Fecha a conexão após o teste
  } catch (err) {
    console.error('Erro ao conectar ao banco de dados:', err.message);
    process.exit(1); // Encerra a aplicação caso a conexão falhe
  }
}

// Rota POST para receber a mensagem HL7
app.post('/receive-hl7', async (req, res) => {
  try {
    // Adiciona um log com a data e hora da requisição
    const requestTime = new Date().toISOString(); // Formata a data e hora no padrão ISO
    console.log(`[${requestTime}] Nova requisição recebida em /receive-hl7`);

    const { hl7Message } = req.body;

    // Verifica se a mensagem HL7 foi enviada
    if (!hl7Message || typeof hl7Message !== 'string') {
      return res.status(400).json({ error: 'A mensagem HL7 é obrigatória e deve ser uma string.' });
    }

    // Exibe a mensagem HL7 completa no console
    console.log('Mensagem HL7 recebida:\n', hl7Message);

    // Aguarda o processamento da mensagem HL7
    let responseHl7 = await fetchHL7(hl7Message);
    console.log('Mensagem HL7 processada:\n', responseHl7);

    // Retorna uma resposta de sucesso
    res.status(200).json({ message: 'Mensagem HL7 recebida com sucesso!', hl7: responseHl7 });
  } catch (err) {
    console.error('Erro ao processar a mensagem HL7:', err);
    res.status(500).json({ error: 'Erro ao processar a mensagem HL7.', details: err.message });
  }
});

// Testa a conexão com o banco antes de iniciar o servidor
testDatabaseConnection().then(() => {
  app.listen(port, () => {
    console.log(`Servidor Comunicacao Smart rodando em 0.0.0.0:${port}`);
  });
});
