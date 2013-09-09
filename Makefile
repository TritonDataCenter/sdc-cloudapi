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
NAME		:= cloudapi
#
# Tools
#
TAP		:= ./node_modules/.bin/tap

#
# Files
#
DOC_FILES	 = index.restdown admin.restdown 65.restdown
JS_FILES	:= $(shell ls *.js) $(shell find lib -name '*.js' -depth 1) \
	$(shell find test -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -f tools/jsstyle.conf
SHRINKWRAP	 = npm-shrinkwrap.json
SMF_MANIFESTS_IN    = smf/manifests/cloudapi.xml.in

CLEAN_FILES	+= node_modules cscope.files docs/index.restdown

# The prebuilt sdcnode version we want. See
# "tools/mk/Makefile.node_prebuilt.targ" for details.
NODE_PREBUILT_VERSION=v0.8.25
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_CC_VERSION=4.6.2
	NODE_PREBUILT_TAG=zone
endif


include ./tools/mk/Makefile.defs
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.defs
else
	include ./tools/mk/Makefile.node.defs
endif
include ./tools/mk/Makefile.smf.defs


#
# Variables
#

# Mountain Gorilla-spec'd versioning.


ROOT                    := $(shell pwd)
RELEASE_TARBALL         := $(NAME)-pkg-$(STAMP).tar.bz2
TMPDIR                  := /tmp/$(STAMP)

#
# Env vars
#
PATH	:= $(NODE_INSTALL)/bin:/opt/local/bin:${PATH}


#
# Repo-specific targets
#
.PHONY: all
all: build sdc-scripts

.PHONY: build
build: $(SMF_MANIFESTS) | $(TAP) $(REPO_DEPS)
	$(NPM) install && $(NPM) update

$(TAP): | $(NPM_EXEC)
	$(NPM) install

# Doc preprocessing to enable getting public and bleeding-edge
# docs out of the same index.restdown.in.
#
# To make the bleeding edge docs:
# 	make clean-docs docs DOCS_PREPROCESS_FLAGS="-D BLEEDING_EDGE"
docs/index.restdown: docs/index.restdown.in
	python tools/preprocess.py -o $@ $(DOCS_PREPROCESS_FLAGS) $<

DOC_CLEAN_FILES = docs/{index,admin}.{html,json} \
	docs/index.restdown build/docs
.PHONY: clean-docs
clean-docs:
	-$(RMTREE) $(DOC_CLEAN_FILES)
clean:: clean-docs


.PHONY: release
release: check build docs
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(TMPDIR)/root/opt/smartdc/cloudapi
	@mkdir -p $(TMPDIR)/site
	@touch $(TMPDIR)/site/.do-not-delete-me
	@mkdir -p $(TMPDIR)/root
	@mkdir -p $(TMPDIR)/root/opt/smartdc/cloudapi/ssl
	cp -r	$(ROOT)/build \
		$(ROOT)/bin \
		$(ROOT)/etc \
		$(ROOT)/lib \
		$(ROOT)/plugins \
		$(ROOT)/main.js \
		$(ROOT)/node_modules \
		$(ROOT)/package.json \
		$(ROOT)/npm-shrinkwrap.json \
		$(ROOT)/sapi_manifests \
		$(ROOT)/smf \
		$(ROOT)/test \
		$(TMPDIR)/root/opt/smartdc/cloudapi/
	mkdir -p $(TMPDIR)/root/opt/smartdc/boot
	cp -R $(ROOT)/deps/sdc-scripts/* $(TMPDIR)/root/opt/smartdc/boot/
	cp -R $(ROOT)/boot/* $(TMPDIR)/root/opt/smartdc/boot/
	(cd $(TMPDIR) && $(TAR) -jcf $(ROOT)/$(RELEASE_TARBALL) root site)
	@rm -rf $(TMPDIR)


.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
	  echo "error: 'BITS_DIR' must be set for 'publish' target"; \
	  exit 1; \
	fi
	mkdir -p $(BITS_DIR)/$(NAME)
	cp $(ROOT)/$(RELEASE_TARBALL) $(BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)

.PHONY: test auth_test account_test datacenters_test datasets_test keys_test machines_test packages_test

auth_test: $(TAP)
	$(TAP) --tap --timeout 120 test/auth.test.js

account_test: $(TAP)
	$(TAP) --tap --timeout 120 test/account.test.js

datacenters_test: $(TAP)
	$(TAP) --tap --timeout 120 test/datacenters.test.js

datasets_test: $(TAP)
	$(TAP) --tap --timeout 120 test/datasets.test.js

keys_test: $(TAP)
	$(TAP) --tap --timeout 120 test/keys.test.js

networks_test: $(TAP)
	$(TAP) --tap --timeout 120 test/networks.test.js

machines_all_test:
	$(TAP) --tap --timeout 480 test/machines.test.js

machines_65_test:
	$(TAP) --tap --timeout 480 test/machines.65.test.js

machines_70_test:
	$(TAP) --tap --timeout 480 test/machines.70.test.js

machines_71_test:
	$(TAP) --tap --timeout 480 test/machines.71.test.js

machines_test: machines_all_test machines_65_test machines_70_test machines_71_test

packages_test: $(TAP)
	$(TAP) --tap --timeout 120 test/packages.test.js

test: auth_test account_test datacenters_test datasets_test keys_test networks_test machines_test packages_test

include ./tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.targ
else
	include ./tools/mk/Makefile.node.targ
endif
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
