// Pacote token emite e verifica as credenciais de sessão do aplicativo.
//
// O formato é um JWT compacto assinado em ES256 (ECDSA P-256 sobre SHA-256).
// A escolha do algoritmo é ditada pelo navegador: o aplicativo precisa
// verificar a assinatura OFFLINE, e ES256 é o único algoritmo assimétrico
// com suporte universal na WebCrypto — Ed25519 ainda falta em aparelhos
// antigos, que são justamente os que vão a campo.
//
// A chave privada existe somente no servidor. O aplicativo embute apenas a
// chave pública (JWK), com a qual não é possível forjar credencial alguma.
package token

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"time"
)

// tamanhoCoordenada é o número de bytes de r e de s na curva P-256.
// A assinatura JWS é a concatenação crua r||s, sem envelope ASN.1.
const tamanhoCoordenada = 32

// Claims são os dados que o aplicativo lê da credencial sem consultar a rede.
type Claims struct {
	// Sub é o identificador da sessão, usado para revalidar e revogar.
	Sub string `json:"sub"`
	// Email é o endereço informado pelo solicitante, para exibição.
	Email string `json:"email"`
	// PainelID e PainelNome identificam o painel liberado.
	PainelID   string `json:"painelId"`
	PainelNome string `json:"painelNome"`
	// DeviceID amarra a credencial ao aparelho que fez a solicitação:
	// copiar o token para outro aparelho não dá acesso.
	DeviceID string `json:"deviceId"`
	// Papel é "montador" ou "responsavel".
	Papel string `json:"papel"`
	Iat   int64  `json:"iat"`
	Exp   int64  `json:"exp"`
}

// Expirado informa se a credencial já passou da validade, na referência dada.
func (c Claims) Expirado(agora time.Time) bool {
	return agora.Unix() >= c.Exp
}

// Assinador emite credenciais. Use CarregarChave ou GerarChave para obter um.
type Assinador struct {
	privada *ecdsa.PrivateKey
}

// GerarChave cria um par novo. Usado pelo subcomando de geração de chave e
// pelos testes; em produção a chave vem de CarregarChave.
func GerarChave() (*Assinador, error) {
	privada, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	return &Assinador{privada: privada}, nil
}

// CarregarChave lê uma chave privada EC em PEM (PKCS#8 ou SEC1).
func CarregarChave(pemBytes []byte) (*Assinador, error) {
	bloco, _ := pem.Decode(pemBytes)
	if bloco == nil {
		return nil, errors.New("a chave privada não está em formato PEM")
	}

	if chave, err := x509.ParseECPrivateKey(bloco.Bytes); err == nil {
		return &Assinador{privada: chave}, nil
	}

	generica, err := x509.ParsePKCS8PrivateKey(bloco.Bytes)
	if err != nil {
		return nil, fmt.Errorf("chave privada ilegível: %w", err)
	}
	chave, ok := generica.(*ecdsa.PrivateKey)
	if !ok {
		return nil, errors.New("a chave privada não é ECDSA P-256")
	}
	return &Assinador{privada: chave}, nil
}

// PEM devolve a chave privada em PKCS#8, para gravar em arquivo ou segredo.
func (a *Assinador) PEM() ([]byte, error) {
	bytes, err := x509.MarshalPKCS8PrivateKey(a.privada)
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: bytes}), nil
}

// JWK devolve a chave pública no formato que o aplicativo importa na
// WebCrypto. É o valor de VITE_AUTH_CHAVE_PUBLICA no build do front.
func (a *Assinador) JWK() ([]byte, error) {
	publica := a.privada.PublicKey
	return json.Marshal(map[string]string{
		"kty": "EC",
		"crv": "P-256",
		"x":   base64url(coordenada(publica.X)),
		"y":   base64url(coordenada(publica.Y)),
	})
}

// Assinar emite a credencial compacta correspondente aos claims.
func (a *Assinador) Assinar(claims Claims) (string, error) {
	cabecalho, err := json.Marshal(map[string]string{"alg": "ES256", "typ": "JWT"})
	if err != nil {
		return "", err
	}
	corpo, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	assinado := base64url(cabecalho) + "." + base64url(corpo)
	resumo := sha256.Sum256([]byte(assinado))

	r, s, err := ecdsa.Sign(rand.Reader, a.privada, resumo[:])
	if err != nil {
		return "", err
	}

	// JWS exige r e s com padding à esquerda até 32 bytes cada.
	assinatura := make([]byte, 0, 2*tamanhoCoordenada)
	assinatura = append(assinatura, coordenada(r)...)
	assinatura = append(assinatura, coordenada(s)...)

	return assinado + "." + base64url(assinatura), nil
}

// coordenada normaliza um inteiro da curva para 32 bytes com zeros à esquerda.
func coordenada(n *big.Int) []byte {
	destino := make([]byte, tamanhoCoordenada)
	n.FillBytes(destino)
	return destino
}

func base64url(dados []byte) string {
	return base64.RawURLEncoding.EncodeToString(dados)
}

// Verificar confere a assinatura e a validade da credencial. O servidor usa
// esta função para autenticar as chamadas da tela de autorizações; o
// aplicativo faz o equivalente na WebCrypto, com a chave pública.
func (a *Assinador) Verificar(bruto string, agora time.Time) (Claims, error) {
	var vazio Claims

	partes := splitN(bruto, '.')
	if len(partes) != 3 {
		return vazio, errors.New("credencial malformada")
	}

	assinatura, err := base64.RawURLEncoding.DecodeString(partes[2])
	if err != nil || len(assinatura) != 2*tamanhoCoordenada {
		return vazio, errors.New("assinatura malformada")
	}

	resumo := sha256.Sum256([]byte(partes[0] + "." + partes[1]))
	r := new(big.Int).SetBytes(assinatura[:tamanhoCoordenada])
	s := new(big.Int).SetBytes(assinatura[tamanhoCoordenada:])
	if !ecdsa.Verify(&a.privada.PublicKey, resumo[:], r, s) {
		return vazio, errors.New("assinatura inválida")
	}

	corpo, err := base64.RawURLEncoding.DecodeString(partes[1])
	if err != nil {
		return vazio, errors.New("corpo malformado")
	}
	var claims Claims
	if err := json.Unmarshal(corpo, &claims); err != nil {
		return vazio, errors.New("corpo ilegível")
	}
	if claims.Expirado(agora) {
		return vazio, errors.New("credencial expirada")
	}
	return claims, nil
}

// splitN separa a credencial nos pontos sem depender de strings.Split,
// mantendo o pacote com o mesmo conjunto enxuto de importações.
func splitN(s string, sep byte) []string {
	var partes []string
	inicio := 0
	for i := 0; i < len(s); i++ {
		if s[i] == sep {
			partes = append(partes, s[inicio:i])
			inicio = i + 1
		}
	}
	return append(partes, s[inicio:])
}
