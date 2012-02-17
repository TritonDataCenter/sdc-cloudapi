#
# Copyright (c) 2012, Joyent, Inc. All rights reserved.
#
# Makefile: basic Makefile for template API service
#
# This Makefile is a template for new repos. It contains only repo-specific
# logic and uses included makefiles to supply common targets (javascriptlint,
# jsstyle, restdown, etc.), which are used by other repos as well. You may well
# need to rewrite most of this file, but you shouldn't need to touch the
# included makefiles.
#
# If you find yourself adding support for new targets that could be useful for
# other projects too, you should add these to the original versions of the
# included Makefiles (in eng.git) so that other teams can use them too.
#

#
# Tools
#
NODE            := node
NPM		:= npm
TAP		:= ./node_modules/.bin/tap
TAR = tar
UNAME := $(shell uname)

ifeq ($(UNAME), SunOS)
	TAR = gtar
endif

#
# Files
#
CFG_FILE         = etc/cloudapi.coal.cfg
DOC_FILES	 = index.restdown
JS_FILES	:= $(shell find lib -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = main.js $(JS_FILES)
JSSTYLE_FLAGS    = -f tools/jsstyle.conf
JSSTYLE_FILES	 = $(JS_FILES)
SMF_MANIFESTS	 = smf/manifests/cloudapi.xml

#
# Variables
#

# Mountain Gorilla-spec'd versioning.
# Need GNU awk for multi-char arg to "-F".
AWK := $(shell (which gawk 2>/dev/null | grep -v "^no ") || (which nawk 2>/dev/null | grep -v "^no ") || which awk)
BRANCH := $(shell git symbolic-ref HEAD | $(AWK) -F/ '{print $$3}')
ifeq ($(TIMESTAMP),)
	TIMESTAMP := $(shell date -u "+%Y%m%dT%H%M%SZ")
endif
GITDESCRIBE := g$(shell git describe --all --long --dirty | $(AWK) -F'-g' '{print $$NF}')
STAMP := $(BRANCH)-$(TIMESTAMP)-$(GITDESCRIBE)

ROOT                    := $(shell pwd)
RELEASE_TARBALL         := cloudapi-pkg-$(STAMP).tar.bz2
TMPDIR                  := /tmp/$(STAMP)


#
# Repo-specific targets
#
.PHONY: build
build:
	$(NPM) rebuild

.PHONY: all
all: build


.PHONY: release
release: check build docs
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(TMPDIR)/root/opt/smartdc/cloudapi
	@mkdir -p $(TMPDIR)/site
	@touch $(TMPDIR)/site/.do-not-delete-me
	@mkdir -p $(TMPDIR)/root
	@mkdir -p $(tmpdir)/root/opt/smartdc/cloudapi/ssl
	cp -r	$(ROOT)/build/docs \
		$(ROOT)/etc \
		$(ROOT)/lib \
		$(ROOT)/main.js \
		$(ROOT)/node_modules \
		$(ROOT)/package.json \
		$(ROOT)/smf \
		$(TMPDIR)/root/opt/smartdc/cloudapi/
	(cd $(TMPDIR) && $(TAR) -jxf $(ROOT)/node-v0.6.10.tar.bz2)
	(cd $(TMPDIR) && $(TAR) -jcf $(ROOT)/$(RELEASE_TARBALL) root site)
	@rm -rf $(TMPDIR)


.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
	  echo "error: 'BITS_DIR' must be set for 'publish' target"; \
	  exit 1; \
	fi
	mkdir -p $(BITS_DIR)/cloudapi
	cp $(ROOT)/$(RELEASE_TARBALL) $(BITS_DIR)/cloudapi/$(RELEASE_TARBALL)

.PHONY: test
test: $(TAP)
	$(TAP) --timeout 120 test/*.test.js

include ./Makefile.deps
include ./Makefile.targ
