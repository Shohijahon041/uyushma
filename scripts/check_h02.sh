#!/bin/bash
systemctl status h02_gateway --no-pager
journalctl -u h02_gateway -n 20 --no-pager

