// Pacote email isola o envio das mensagens de solicitação.
//
// O serviço de transporte ainda depende de definição do TI. A interface
// Emissor existe para que essa pendência não bloqueie o resto: o servidor
// sobe hoje com o emissor de log, e trocar para SMTP é mudar variável de
// ambiente, não código.
package email

import (
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// Mensagem é o que o domínio pede para enviar, sem saber por onde vai sair.
type Mensagem struct {
	Para      string
	Assunto   string
	Texto     string
	HTML      string
	Responder string
}

// Emissor entrega a mensagem. As implementações são EmissorLog e EmissorSMTP.
type Emissor interface {
	Enviar(Mensagem) error
}

// EmissorLog grava a mensagem no log em vez de enviá-la. É o padrão enquanto
// o TI não define o transporte: o fluxo inteiro pode ser exercitado em
// desenvolvimento copiando o link de aprovação que aparece no log.
type EmissorLog struct{}

func (EmissorLog) Enviar(m Mensagem) error {
	log.Printf("[e-mail não enviado — emissor de log]\nPara: %s\nAssunto: %s\n\n%s\n",
		m.Para, m.Assunto, m.Texto)
	return nil
}

// EmissorSMTP envia por um servidor SMTP — o caminho para o SMTP corporativo.
type EmissorSMTP struct {
	Host    string
	Porta   int
	Usuario string
	Senha   string
	De      string
	DeNome  string
	// SemTLS desliga o STARTTLS. Só faz sentido em relay interno sem
	// autenticação; nunca em servidor que exige credencial.
	SemTLS bool
}

func (e EmissorSMTP) Enviar(m Mensagem) error {
	endereco := net.JoinHostPort(e.Host, fmt.Sprint(e.Porta))

	cliente, err := smtp.Dial(endereco)
	if err != nil {
		return fmt.Errorf("conexão SMTP com %s: %w", endereco, err)
	}
	defer func() { _ = cliente.Close() }()

	if !e.SemTLS {
		if ok, _ := cliente.Extension("STARTTLS"); !ok {
			return errors.New("o servidor SMTP não oferece STARTTLS; " +
				"corrija o servidor ou defina SMTP_SEM_TLS=1 conscientemente")
		}
		if err := cliente.StartTLS(&tls.Config{ServerName: e.Host}); err != nil {
			return fmt.Errorf("STARTTLS: %w", err)
		}
	}

	if e.Usuario != "" {
		if err := cliente.Auth(smtp.PlainAuth("", e.Usuario, e.Senha, e.Host)); err != nil {
			return fmt.Errorf("autenticação SMTP: %w", err)
		}
	}

	if err := cliente.Mail(e.De); err != nil {
		return fmt.Errorf("remetente recusado: %w", err)
	}
	if err := cliente.Rcpt(m.Para); err != nil {
		return fmt.Errorf("destinatário recusado: %w", err)
	}

	escritor, err := cliente.Data()
	if err != nil {
		return err
	}
	if _, err := escritor.Write(e.montar(m)); err != nil {
		return err
	}
	if err := escritor.Close(); err != nil {
		return err
	}
	return cliente.Quit()
}

// montar produz uma mensagem multipart/alternative: o cliente de e-mail
// mostra o HTML quando sabe, e o texto puro quando não.
func (e EmissorSMTP) montar(m Mensagem) []byte {
	fronteira := fmt.Sprintf("limite-%d", time.Now().UnixNano())

	var b strings.Builder
	fmt.Fprintf(&b, "From: %s <%s>\r\n", mime.QEncoding.Encode("utf-8", e.DeNome), e.De)
	fmt.Fprintf(&b, "To: %s\r\n", m.Para)
	if m.Responder != "" {
		fmt.Fprintf(&b, "Reply-To: %s\r\n", m.Responder)
	}
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", m.Assunto))
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	b.WriteString("MIME-Version: 1.0\r\n")
	fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", fronteira)

	fmt.Fprintf(&b, "--%s\r\n", fronteira)
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n\r\n")
	b.WriteString(m.Texto)

	fmt.Fprintf(&b, "\r\n--%s\r\n", fronteira)
	b.WriteString("Content-Type: text/html; charset=utf-8\r\n\r\n")
	b.WriteString(m.HTML)

	fmt.Fprintf(&b, "\r\n--%s--\r\n", fronteira)
	return []byte(b.String())
}
