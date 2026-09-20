package main

import (
	"testing"
	"time"
)

func TestNormalizeNetworkFlow_RouterSyslog_Drop(t *testing.T) {
	raw := map[string]interface{}{
		"message": "<4>Sep 20 12:00:00 router kernel: DROP IN=eth0 OUT= MAC=00:11:22:33:44:55 SRC=203.0.113.55 DST=192.168.1.105 LEN=64 PROTO=TCP SPT=44444 DPT=80",
	}

	flow, err := NormalizeNetworkFlow("router_syslog", "test-evt-1", time.Now(), raw)
	if err != nil {
		t.Fatalf("NormalizeNetworkFlow failed: %v", err)
	}

	if flow.Application != "router_firewall_drop" {
		t.Errorf("Expected Application 'router_firewall_drop', got '%s'", flow.Application)
	}
	if flow.SourceIP != "203.0.113.55" {
		t.Errorf("Expected SourceIP '203.0.113.55', got '%s'", flow.SourceIP)
	}
	if flow.DestinationIP != "192.168.1.105" {
		t.Errorf("Expected DestinationIP '192.168.1.105', got '%s'", flow.DestinationIP)
	}
	if flow.Protocol != "TCP" {
		t.Errorf("Expected Protocol 'TCP', got '%s'", flow.Protocol)
	}
	if flow.SourcePort != 44444 {
		t.Errorf("Expected SourcePort 44444, got %d", flow.SourcePort)
	}
	if flow.DestinationPort != 80 {
		t.Errorf("Expected DestinationPort 80, got %d", flow.DestinationPort)
	}
	if flow.BytesOut != 64 {
		t.Errorf("Expected BytesOut 64, got %d", flow.BytesOut)
	}
}

func TestNormalizeNetworkFlow_RouterSyslog_DHCP(t *testing.T) {
	raw := map[string]interface{}{
		"message": "dnsmasq-dhcp[1024]: DHCPACK(br0) 192.168.1.105 34:2e:b7:aa:bb:cc iPhone-15",
	}

	flow, err := NormalizeNetworkFlow("syslog", "test-evt-2", time.Now(), raw)
	if err != nil {
		t.Fatalf("NormalizeNetworkFlow failed: %v", err)
	}

	if flow.Application != "dhcp_lease" {
		t.Errorf("Expected Application 'dhcp_lease', got '%s'", flow.Application)
	}
	if flow.DestinationIP != "192.168.1.105" {
		t.Errorf("Expected DestinationIP '192.168.1.105', got '%s'", flow.DestinationIP)
	}
	if flow.FlowID != "dhcp-34:2e:b7:aa:bb:cc" {
		t.Errorf("Expected FlowID 'dhcp-34:2e:b7:aa:bb:cc', got '%s'", flow.FlowID)
	}
}

func TestNormalizeNetworkFlow_RouterSyslog_WiFi6Assoc(t *testing.T) {
	raw := map[string]interface{}{
		"message": "kernel: wl0: IEEE 802.11ax association request from 34:2e:b7:aa:bb:cc",
	}

	flow, err := NormalizeNetworkFlow("router_syslog", "test-evt-3", time.Now(), raw)
	if err != nil {
		t.Fatalf("NormalizeNetworkFlow failed: %v", err)
	}

	if flow.Application != "wifi6_association" {
		t.Errorf("Expected Application 'wifi6_association', got '%s'", flow.Application)
	}
	if flow.Protocol != "802.11ax" {
		t.Errorf("Expected Protocol '802.11ax', got '%s'", flow.Protocol)
	}
}

func TestNormalizeNetworkFlow_RouterSyslog_FirewallDrop_WithDNSMapping(t *testing.T) {
	raw := map[string]interface{}{
		"message": "<4>Sep 20 12:00:00 router kernel: DROP IN=eth0 OUT= MAC=00:11:22:33:44:55 SRC=192.168.1.105 DST=203.0.113.55 LEN=64 PROTO=TCP SPT=55555 DPT=443",
	}

	flow, err := NormalizeNetworkFlow("router_syslog", "test-evt-drop", time.Now(), raw)
	if err != nil {
		t.Fatalf("NormalizeNetworkFlow failed: %v", err)
	}

	if flow.RouterAction != "DROP" {
		t.Errorf("Expected RouterAction 'DROP', got '%s'", flow.RouterAction)
	}
	if flow.RouterInterface != "eth0" {
		t.Errorf("Expected RouterInterface 'eth0', got '%s'", flow.RouterInterface)
	}
	if flow.SourceIP != "192.168.1.105" || flow.DestinationIP != "203.0.113.55" {
		t.Errorf("Unexpected IPs: src=%s dst=%s", flow.SourceIP, flow.DestinationIP)
	}

	// Associate with DNS event
	dnsEvents := []DNSEvent{
		{
			EventID:     "dns-1",
			ClientIP:    "192.168.1.105",
			QueryName:   "c2-malicious.org",
			QueryType:   "A",
			ResponseIPs: []string{"203.0.113.55"},
			Timestamp:   flow.Timestamp,
		},
	}

	AssociateDNSWithFlow(&flow, dnsEvents)

	if flow.DstHostname != "c2-malicious.org" {
		t.Errorf("Expected DstHostname 'c2-malicious.org', got '%s'", flow.DstHostname)
	}
}

func TestNormalizeNetworkFlow_DNSEvent_Association_ToFlow(t *testing.T) {
	now := time.Now()
	rawDNS := map[string]interface{}{
		"message": "dnsmasq[1234]: reply google.com is 142.250.190.46",
	}

	dnsEvt, err := ParseDNSEvent(rawDNS, now)
	if err != nil {
		t.Fatalf("ParseDNSEvent failed: %v", err)
	}

	if dnsEvt.QueryName != "google.com" {
		t.Errorf("Expected QueryName 'google.com', got '%s'", dnsEvt.QueryName)
	}
	if len(dnsEvt.ResponseIPs) == 0 || dnsEvt.ResponseIPs[0] != "142.250.190.46" {
		t.Errorf("Expected ResponseIP '142.250.190.46', got %v", dnsEvt.ResponseIPs)
	}

	flow := NetworkFlow{
		EventID:         "flow-1",
		Timestamp:       now.Add(1 * time.Second),
		SourceIP:        "192.168.1.105",
		DestinationIP:   "142.250.190.46",
		DestinationPort: 443,
		Protocol:        "TCP",
	}

	AssociateDNSWithFlow(&flow, []DNSEvent{dnsEvt})

	if flow.DstHostname != "google.com" {
		t.Errorf("Expected DstHostname 'google.com', got '%s'", flow.DstHostname)
	}
}
