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
            stage('Setup Docker Buildx') {
                steps {
                    echo 'Setting up Docker Buildx'
                    sh '''
                        export DOCKER_CLI_EXPERIMENTAL=enabled
                        docker run --rm --privileged docker/binfmt:a7996909642ee92942dcd6cff44b9b95f08dad64
                        docker buildx rm mybuilder || true
                        docker buildx create --name mybuilder --driver docker-container --use
                        docker buildx inspect mybuilder --bootstrap
                    '''
                }
            }

            stage('Build and Push Docker Image') {
                steps {
                    echo 'Building and Pushing Docker Image'
                    script {
                        sh 'docker buildx build --platform linux/arm64 -t ie3vm049:5001/oracle-redoxflow:latest --load .'
                        sh 'docker push ie3vm049:5001/oracle-redoxflow:latest' 
                    }
                }
            }

        stage('Trigger Portainer Webhook') {
            steps {
                echo 'Triggering Portainer Webhook'
                sh '''
                    curl --insecure --request POST tbd
                '''
            }
        }
    }
}
