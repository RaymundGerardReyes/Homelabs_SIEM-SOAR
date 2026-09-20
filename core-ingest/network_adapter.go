// network_adapter.go
package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	dropProtoRegex    = regexp.MustCompile(`PROTO=(\w+)`)
	dropSrcRegex      = regexp.MustCompile(`SRC=([0-9a-fA-F.:]+)`)
	dropDstRegex      = regexp.MustCompile(`DST=([0-9a-fA-F.:]+)`)
	dropSptRegex      = regexp.MustCompile(`SPT=(\d+)`)
	dropDptRegex      = regexp.MustCompile(`DPT=(\d+)`)
	dropLenRegex      = regexp.MustCompile(`LEN=(\d+)`)
	dhcpIPRegex       = regexp.MustCompile(`DHCPACK.*?(\d+\.\d+\.\d+\.\d+)`)
	dhcpMacRegex      = regexp.MustCompile(`([0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2})`)
	inInterfaceRegex  = regexp.MustCompile(`IN=(\w+)`)
	outInterfaceRegex = regexp.MustCompile(`OUT=(\w+)`)
	dnsQueryRegex     = regexp.MustCompile(`query\[([A-Z]+)\]\s+([^\s]+)\s+from\s+([0-9a-fA-F.:]+)`)
	dnsReplyRegex     = regexp.MustCompile(`reply\s+([^\s]+)\s+is\s+([0-9a-fA-F.:]+)`)
)

// DNSEvent represents an observed DNS query and response event on the gateway bridge.
type DNSEvent struct {
	EventID        string    `json:"event_id"`
	Timestamp      time.Time `json:"timestamp"`
	ClientIP       string    `json:"client_ip"`
	ClientMAC      string    `json:"client_mac"`
	ClientHostname string    `json:"client_hostname"`
	QueryName      string    `json:"query_name"`
	QueryType      string    `json:"query_type"`
	ResponseIPs    []string  `json:"response_ips"`
	ResolverIP     string    `json:"resolver_ip"`
}

// NetworkFlow represents our universal, canonical network observation.
// Your SIEM will use this format regardless of where the data came from.
type NetworkFlow struct {
	EventID         string
	FlowID          string
	Timestamp       time.Time
	SourceIP        string
	SourcePort      uint16
	DestinationIP   string
	DestinationPort uint16
	Protocol        string
	Application     string
	BytesOut        uint64
	BytesIn         uint64
	PacketsOut      uint64
	PacketsIn       uint64
	// WiFi Router & Site-Visit Tracking Extensions:
	SrcMAC          string
	SrcHostname     string
	DstHostname     string
	RouterAction    string // ALLOW, DROP, NAT, FORWARD
	RouterInterface string // e.g. wan0, br0, eth0
}

// AssociateDNSWithFlow maps DNS resolution records to an active NetworkFlow,
// populating DstHostname when the destination IP matches a resolved record.
func AssociateDNSWithFlow(flow *NetworkFlow, dnsEvents []DNSEvent) {
	if flow == nil || len(dnsEvents) == 0 {
		return
	}
	for _, dns := range dnsEvents {
		for _, respIP := range dns.ResponseIPs {
			if flow.DestinationIP == respIP {
				flow.DstHostname = dns.QueryName
				return
			}
		}
		if flow.SourceIP == dns.ClientIP && flow.DstHostname == "" {
			diff := flow.Timestamp.Sub(dns.Timestamp)
			if diff >= -5*time.Second && diff <= 30*time.Second {
				flow.DstHostname = dns.QueryName
				return
			}
		}
	}
}

// NormalizeNetworkFlow translates arbitrary sensor data into our canonical format.
func NormalizeNetworkFlow(sensorType string, eventID string, timestamp time.Time, raw map[string]interface{}) (NetworkFlow, error) {
	// Initialize our canonical struct with standard metadata
	flow := NetworkFlow{
		EventID:   eventID,
		Timestamp: timestamp,
	}

	// Route the parsing logic based on the sensor type
	switch strings.ToLower(sensorType) {
	case "zeek":
		// Map Zeek's directional terminology (orig/resp)
		flow.FlowID = getString(raw, "uid")
		flow.SourceIP = getString(raw, "id.orig_h")
		flow.SourcePort = uint16(getFloat(raw, "id.orig_p"))
		flow.DestinationIP = getString(raw, "id.resp_h")
		flow.DestinationPort = uint16(getFloat(raw, "id.resp_p"))
		flow.Protocol = getString(raw, "proto")
		flow.Application = getString(raw, "service")
		flow.BytesOut = uint64(getFloat(raw, "orig_bytes"))
		flow.BytesIn = uint64(getFloat(raw, "resp_bytes"))
		flow.PacketsOut = uint64(getFloat(raw, "orig_pkts"))
		flow.PacketsIn = uint64(getFloat(raw, "resp_pkts"))

	case "suricata":
		// Map Suricata's EVE terminology (src/dest, toserver/toclient)
		if val, ok := raw["flow_id"]; ok {
			flow.FlowID = fmt.Sprintf("%v", val)
		}
		flow.SourceIP = getString(raw, "src_ip")
		flow.SourcePort = uint16(getFloat(raw, "src_port"))
		flow.DestinationIP = getString(raw, "dest_ip")
		flow.DestinationPort = uint16(getFloat(raw, "dest_port"))
		flow.Protocol = getString(raw, "proto")
		flow.Application = getString(raw, "app_proto")

		// Suricata nests flow metrics inside a "flow" object
		if flowMetrics, ok := raw["flow"].(map[string]interface{}); ok {
			flow.BytesOut = uint64(getFloat(flowMetrics, "bytes_toserver"))
			flow.BytesIn = uint64(getFloat(flowMetrics, "bytes_toclient"))
			flow.PacketsOut = uint64(getFloat(flowMetrics, "pkts_toserver"))
			flow.PacketsIn = uint64(getFloat(flowMetrics, "pkts_toclient"))
		}

	case "syslog", "router_syslog":
		// Map router syslog (Asus, TP-Link, Netgear, OpenWrt drop/DHCP/WiFi 6 logs)
		msg := getString(raw, "message")
		if msg == "" {
			msg = getString(raw, "log")
		}
		flow.Application = "router_syslog"
		flow.FlowID = fmt.Sprintf("syslog-%d", timestamp.UnixNano())

		// Extract interface and MAC metadata if available
		if m := outInterfaceRegex.FindStringSubmatch(msg); len(m) > 1 {
			flow.RouterInterface = m[1]
		} else if m := inInterfaceRegex.FindStringSubmatch(msg); len(m) > 1 {
			flow.RouterInterface = m[1]
		}
		if m := dhcpMacRegex.FindStringSubmatch(msg); len(m) > 1 {
			flow.SrcMAC = m[1]
		}

		if strings.Contains(msg, "DROP") || strings.Contains(msg, "BLOCK") {
			flow.Application = "router_firewall_drop"
			flow.RouterAction = "DROP"
			if m := dropProtoRegex.FindStringSubmatch(msg); len(m) > 1 {
				flow.Protocol = m[1]
			}
			if m := dropSrcRegex.FindStringSubmatch(msg); len(m) > 1 {
				flow.SourceIP = m[1]
			}
			if m := dropDstRegex.FindStringSubmatch(msg); len(m) > 1 {
				flow.DestinationIP = m[1]
			}
			if m := dropSptRegex.FindStringSubmatch(msg); len(m) > 1 {
				if port, err := strconv.ParseUint(m[1], 10, 16); err == nil {
					flow.SourcePort = uint16(port)
				}
			}
			if m := dropDptRegex.FindStringSubmatch(msg); len(m) > 1 {
				if port, err := strconv.ParseUint(m[1], 10, 16); err == nil {
					flow.DestinationPort = uint16(port)
				}
			}
			if m := dropLenRegex.FindStringSubmatch(msg); len(m) > 1 {
				if length, err := strconv.ParseUint(m[1], 10, 64); err == nil {
					flow.BytesOut = length
				}
			}
			flow.PacketsOut = 1
		} else if strings.Contains(msg, "ACCEPT") || strings.Contains(msg, "ALLOW") || strings.Contains(msg, "FORWARD") {
			flow.Application = "router_forward"
			flow.RouterAction = "ALLOW"
			if m := dropProtoRegex.FindStringSubmatch(msg); len(m) > 1 {
				flow.Protocol = m[1]
			}
			if m := dropSrcRegex.FindStringSubmatch(msg); len(m) > 1 {
				flow.SourceIP = m[1]
			}
			if m := dropDstRegex.FindStringSubmatch(msg); len(m) > 1 {
				flow.DestinationIP = m[1]
			}
			if m := dropSptRegex.FindStringSubmatch(msg); len(m) > 1 {
				if port, err := strconv.ParseUint(m[1], 10, 16); err == nil {
					flow.SourcePort = uint16(port)
				}
			}
			if m := dropDptRegex.FindStringSubmatch(msg); len(m) > 1 {
				if port, err := strconv.ParseUint(m[1], 10, 16); err == nil {
					flow.DestinationPort = uint16(port)
				}
			}
		} else if strings.Contains(msg, "DHCPACK") {
			flow.Protocol = "UDP"
			flow.Application = "dhcp_lease"
			flow.RouterAction = "ALLOW"
			flow.SourcePort = 67
			flow.DestinationPort = 68
			if m := dhcpIPRegex.FindStringSubmatch(msg); len(m) > 1 {
				flow.DestinationIP = m[1]
			}
			if m := dhcpMacRegex.FindStringSubmatch(msg); len(m) > 1 {
				flow.FlowID = "dhcp-" + m[1]
				flow.SrcMAC = m[1]
			}
		} else if strings.Contains(msg, "802.11ax") || strings.Contains(msg, "assoc") {
			flow.Protocol = "802.11ax"
			flow.Application = "wifi6_association"
			flow.RouterAction = "ALLOW"
			if m := dhcpMacRegex.FindStringSubmatch(msg); len(m) > 1 {
				flow.FlowID = "wifi6-" + m[1]
				flow.SrcMAC = m[1]
			}
		}

	case "dns", "dns_log", "dnsmasq":
		msg := getString(raw, "message")
		if msg == "" {
			msg = getString(raw, "log")
		}
		flow.Protocol = "UDP"
		flow.SourcePort = 53
		flow.DestinationPort = 53
		flow.Application = "dns_query"
		flow.RouterAction = "ALLOW"
		flow.FlowID = fmt.Sprintf("dns-%d", timestamp.UnixNano())

		if q := getString(raw, "query_name"); q != "" {
			flow.DstHostname = q
		}
		if client := getString(raw, "client_ip"); client != "" {
			flow.SourceIP = client
		}
		if resp := getString(raw, "response_ip"); resp != "" {
			flow.DestinationIP = resp
		}

		if m := dnsQueryRegex.FindStringSubmatch(msg); len(m) > 3 {
			flow.DstHostname = m[2]
			flow.SourceIP = m[3]
			flow.DestinationIP = "192.168.1.1"
		} else if m := dnsReplyRegex.FindStringSubmatch(msg); len(m) > 2 {
			flow.DstHostname = m[1]
			flow.DestinationIP = m[2]
			flow.SourceIP = "192.168.1.1"
		}

	default:
		return flow, fmt.Errorf("unsupported network sensor type: %s", sensorType)
	}

	return flow, nil
}

// ParseDNSEvent converts raw telemetry payload into a structured DNSEvent
func ParseDNSEvent(raw map[string]interface{}, timestamp time.Time) (DNSEvent, error) {
	evt := DNSEvent{
		EventID:    getString(raw, "event_id"),
		Timestamp:  timestamp,
		ClientIP:   getString(raw, "client_ip"),
		ClientMAC:  getString(raw, "client_mac"),
		QueryName:  getString(raw, "query_name"),
		QueryType:  getString(raw, "query_type"),
		ResolverIP: getString(raw, "resolver_ip"),
	}
	if evt.EventID == "" {
		evt.EventID = fmt.Sprintf("dns-evt-%d", timestamp.UnixNano())
	}
	if evt.ResolverIP == "" {
		evt.ResolverIP = "192.168.1.1"
	}

	// Also support parsing from raw syslog/dnsmasq message
	msg := getString(raw, "message")
	if msg == "" {
		msg = getString(raw, "log")
	}
	if m := dnsQueryRegex.FindStringSubmatch(msg); len(m) > 3 {
		evt.QueryType = m[1]
		evt.QueryName = m[2]
		evt.ClientIP = m[3]
	} else if m := dnsReplyRegex.FindStringSubmatch(msg); len(m) > 2 {
		evt.QueryName = m[1]
		evt.ResponseIPs = append(evt.ResponseIPs, m[2])
	}
	return evt, nil
}

// --- Helper functions to safely extract data from generic JSON maps ---

func getString(m map[string]interface{}, key string) string {
	if val, ok := m[key].(string); ok {
		return val
	}
	return ""
}

func getFloat(m map[string]interface{}, key string) float64 {
	if val, ok := m[key].(float64); ok {
		return val
	}
	return 0
}
