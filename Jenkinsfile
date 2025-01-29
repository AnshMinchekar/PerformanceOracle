pipeline {
   agent any
    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm install'
            }
        }
        stage('SonarQube Analysis') {        
           steps {
                script {
                    def scannerHome = tool 'SonarScanner_5_0_1'
                    withSonarQubeEnv() {
                        sh "${scannerHome}/bin/sonar-scanner"
                    }
                }
            }
        }
        stage("Quality Gate") {
            steps {
                timeout(time: 1, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }
        stage('Build Docker Image') {
            steps {
                echo 'Building Docker Image'
                script {
                    app = docker.build("hardhat-performance-oracle")
                }
            }
        }
        stage('Push Docker Image') {
            steps {
                echo 'Pushing Docker Image'
                script {
                    docker.withRegistry("http://ie3vm049:5001") {
                        app.push("latest")
                    }
                }
            }
        }
         stage('Trigger Portainer Webhook') {
            steps {
                echo 'Triggering Portainer Webhook'
                sh '''
                    curl --insecure --request POST https://ie3vm034:9443/api/webhooks/8414aa85-9184-41da-9e1c-fd8597de456f
                '''
            }
        }
    }
}
