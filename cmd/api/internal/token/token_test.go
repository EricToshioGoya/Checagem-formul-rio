package token

import (
	"testing"
	"time"
)

func claimsDeTeste(exp time.Time) Claims {
	return Claims{
		Sub:      "sessao-1",
		Email:    "montador@empresa.com.br",
		PainelID: "system-pro-e-power",
		DeviceID: "aparelho-1",
		Papel:    "montador",
		Iat:      exp.Add(-time.Hour).Unix(),
		Exp:      exp.Unix(),
	}
}

func TestAssinarEVerificar(t *testing.T) {
	assinador, err := GerarChave()
	if err != nil {
		t.Fatal(err)
	}
	agora := time.Now()

	credencial, err := assinador.Assinar(claimsDeTeste(agora.Add(time.Hour)))
	if err != nil {
		t.Fatal(err)
	}

	lido, err := assinador.Verificar(credencial, agora)
	if err != nil {
		t.Fatalf("credencial recém-emitida deveria ser válida: %v", err)
	}
	if lido.Email != "montador@empresa.com.br" || lido.DeviceID != "aparelho-1" {
		t.Fatalf("claims não sobreviveram ao trajeto: %+v", lido)
	}
}

func TestVerificarRecusaCredencialExpirada(t *testing.T) {
	assinador, err := GerarChave()
	if err != nil {
		t.Fatal(err)
	}
	agora := time.Now()

	credencial, err := assinador.Assinar(claimsDeTeste(agora.Add(-time.Minute)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := assinador.Verificar(credencial, agora); err == nil {
		t.Fatal("credencial expirada foi aceita")
	}
}

func TestVerificarRecusaAssinaturaDeOutraChave(t *testing.T) {
	emissor, err := GerarChave()
	if err != nil {
		t.Fatal(err)
	}
	intruso, err := GerarChave()
	if err != nil {
		t.Fatal(err)
	}
	agora := time.Now()

	forjada, err := intruso.Assinar(claimsDeTeste(agora.Add(time.Hour)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := emissor.Verificar(forjada, agora); err == nil {
		t.Fatal("credencial assinada por outra chave foi aceita")
	}
}

func TestVerificarRecusaCorpoAdulterado(t *testing.T) {
	assinador, err := GerarChave()
	if err != nil {
		t.Fatal(err)
	}
	agora := time.Now()

	credencial, err := assinador.Assinar(claimsDeTeste(agora.Add(time.Hour)))
	if err != nil {
		t.Fatal(err)
	}

	// Troca um caractere do corpo: é a tentativa de promover-se a
	// responsável editando o token guardado no aparelho.
	partes := splitN(credencial, '.')
	adulterada := partes[0] + "." + partes[1][:len(partes[1])-1] + "X." + partes[2]

	if _, err := assinador.Verificar(adulterada, agora); err == nil {
		t.Fatal("credencial adulterada foi aceita")
	}
}

func TestJWKDescreveAChavePublica(t *testing.T) {
	assinador, err := GerarChave()
	if err != nil {
		t.Fatal(err)
	}
	jwk, err := assinador.JWK()
	if err != nil {
		t.Fatal(err)
	}
	for _, esperado := range []string{`"kty":"EC"`, `"crv":"P-256"`, `"x":`, `"y":`} {
		if !contem(string(jwk), esperado) {
			t.Fatalf("JWK sem %s: %s", esperado, jwk)
		}
	}
}

func contem(texto, procurado string) bool {
	for i := 0; i+len(procurado) <= len(texto); i++ {
		if texto[i:i+len(procurado)] == procurado {
			return true
		}
	}
	return false
}
