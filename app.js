require('dotenv').config(); // Carrega as variáveis do .env
const express = require('express');
const sql = require('mssql');

const app = express(); // Inicializa o Express
const port = process.env.APP_PORT; // Porta para o servidor

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
async function fetchSampleById(id_amostra) {
  try {
    // Conecta ao banco de dados
    const pool = await sql.connect(config);
    console.log(id_amostra);
    // Prepara e executa a query com o parâmetro
    const result = await pool
      .request()
      .input('id', sql.Int, id_amostra) // Substitui o parâmetro na query
      .query(
        `SELECT psv_cod,osm_serie, osm_num, smm_num, smm_cod_amostra, pac_reg FROM smart.SMM
          inner join smart.osm on smm.SMM_OSM = osm.osm_num and smm.SMM_OSM_SERIE = osm.osm_serie
          inner join smart.psv on osm.OSM_MREQ = psv.PSV_COD
          inner join smart.pac on osm.osm_pac = pac.pac_reg
          WHERE smm_cod_amostra = @id`
        );

    // Fecha a conexão
    await sql.close();

    // Retorna os dados encontrados
    return result.recordset;
  } catch (err) {
    console.error('Erro ao acessar o MSSQL:', err);
    throw err;
  }
}

// Rota para buscar dados pelo id_amostra
app.get('/amostra/:id_amostra', async (req, res) => {
  const { id_amostra } = req.params;

  try {
    // Valida se o ID é um número
    if (isNaN(id_amostra)) {
      return res.status(400).json({ error: 'O id_amostra deve ser um número.' });
    }

    // Busca os dados no banco
    const data = await fetchSampleById(parseInt(id_amostra, 10));

    // Verifica se os dados foram encontrados
    if (data.length === 0) {
      return res.status(404).json({ error: 'Amostra não encontrada.' });
    }

    // Retorna os dados encontrados
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar a amostra.', details: err.message });
  }
});

// Inicia o servidor
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});

/*
MSH|^~\&|LIS|CH|ESM||20240816105133362|Default|OUL^R21|3ba97cf9-9f91-4471-a9cf-ecdff92aff50|P|2.5.1
PID|||616306||de Teste Homolog Automatizada, entrada com parâmetros^Paciente||30082004|F||||||||||||||U|
PV1|||^^^54||||12345^Spilimbergo^Fernanda^^^ Dr ^^11968563969|
ORC|NW|
SAC|RJ-99999|
NTE|1|||C|
SPM|1|504378354159|||||ADE|Liver|||||||||30082024|30082024||||
SPM
NTE|1|||C|
ZBL|RJ-100000-A1.1| (block ID)  
OBR|1|||504378354180|
OBX|2|TX|STN||DIGI^Digitalização|
NTE|1|||C|
*/