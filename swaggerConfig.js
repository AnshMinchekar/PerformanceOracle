const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Performance Metrics API',
            version: '1.0.0',
            description: 'API to execute and monitor scripts for performance metrics',
        },
        servers: [
            {
                url: 'http://localhost:3000', // Replace with your base URL
            },
        ],
    },
    apis: ['./server.js'], // Path to your API docs (update if needed)
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
