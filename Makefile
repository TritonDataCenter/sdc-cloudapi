#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2019, Joyent, Inc.
#

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
DOC_FILES	 = index.md admin.md dev.md
RESTDOWN_FLAGS   = --brand-dir=deps/restdown-brand-remora
EXTRA_DOC_DEPS += deps/restdown-brand-remora/.git
# We explicitly don't want to lint node-http-signature, as it's an external
# repository that is exceptionally bundled in this repo to ensure backward
# compatibilty when handling different signature formats.
JS_FILES	:= $(shell ls *.js) $(shell find lib -name '*.js' | grep -v node-http-signature) \
	$(shell find test -name '*.js') $(shell find bench -name '*.js') \
	$(shell find plugins -name '*.js') \
	$(shell find test -name '*.javascript')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -f tools/jsstyle.conf
SMF_MANIFESTS_IN    = smf/manifests/cloudapi.xml.in smf/manifests/haproxy.xml.in smf/manifests/stud.xml.in

CLEAN_FILES	+= node_modules cscope.files

# The prebuilt sdcnode version we want. See
# "tools/mk/Makefile.node_prebuilt.targ" for details.
NODE_PREBUILT_VERSION=v4.9.0
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_IMAGE=18b094b0-eb01-11e5-80c1-175dac7ddf02
	NODE_PREBUILT_TAG=zone
else
	NPM=npm
	NODE=node
	NPM_EXEC=$(shell which npm)
	NODE_EXEC=$(shell which node)
endif

ENGBLD_USE_BUILDIMAGE	= true
ENGBLD_REQUIRE		:= $(shell git submodule update --init deps/eng)
include ./deps/eng/tools/mk/Makefile.defs
TOP ?= $(error Unable to access eng.git submodule Makefiles.)

ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.defs
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.defs
endif
include ./deps/eng/tools/mk/Makefile.smf.defs

#
# Variables
#

# Mountain Gorilla-spec'd versioning.

ROOT                    := $(shell pwd)
RELEASE_TARBALL         := $(NAME)-pkg-$(STAMP).tar.gz
RELSTAGEDIR				:= /tmp/$(NAME)-$(STAMP)

BASE_IMAGE_UUID = 04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f
BUILDIMAGE_NAME = $(NAME)
BUILDIMAGE_DESC	= SDC CloudAPI
BUILDIMAGE_PKGSRC = \
	openssl-1.0.2o \
	stud-0.3p53nb5 \
 	haproxy-1.6.2
AGENTS		= amon config registrar

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
	$(NPM) install

$(TAP): | $(NPM_EXEC)
	$(NPM) install

DOC_CLEAN_FILES = docs/{index,admin,dev}.{html,json} build/docs
.PHONY: clean-docs
clean-docs:
	-$(RMTREE) $(DOC_CLEAN_FILES)
clean:: clean-docs

.PHONY: release
release: check all docs
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/cloudapi
	@mkdir -p $(RELSTAGEDIR)/site
	@touch $(RELSTAGEDIR)/site/.do-not-delete-me
	@mkdir -p $(RELSTAGEDIR)/root
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/cloudapi/ssl
	cp -r	$(ROOT)/bin \
		$(ROOT)/etc \
		$(ROOT)/lib \
		$(ROOT)/plugins \
		$(ROOT)/main.js \
		$(ROOT)/node_modules \
		$(ROOT)/package.json \
		$(ROOT)/sapi_manifests \
		$(ROOT)/smf \
		$(ROOT)/test \
		$(ROOT)/tools \
		$(RELSTAGEDIR)/root/opt/smartdc/cloudapi/
	mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/boot
	cp -R $(ROOT)/deps/sdc-scripts/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	cp -R $(ROOT)/boot/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/build
	cp -r \
		$(TOP)/build/node \
		$(TOP)/build/docs \
		$(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/build
	(cd $(RELSTAGEDIR) && $(TAR) -I pigz -cf $(ROOT)/$(RELEASE_TARBALL) root site)
	@rm -rf $(RELSTAGEDIR)


.PHONY: publish
publish: release
	mkdir -p $(ENGBLD_BITS_DIR)/$(NAME)
	cp $(ROOT)/$(RELEASE_TARBALL) $(ENGBLD_BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)

.PHONY: test no_machines_test auth_test account_test datacenters_test datasets_test fabrics_test images_test keys_test networks_test nics_test machines_all_test machines_70_test machines_71_test machines_72_test machines_73_test machines_80_test machines_test packages_test populate_networks_test services_test users_test provision_limits_plugin_test plugins_test tests_test

auth_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/auth.test.js

account_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/account.test.js

datacenters_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/datacenters.test.js

datasets_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/datasets.test.js

fabrics_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/fabrics.test.js

images_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/images.70.test.js
	$(NODE_EXEC) $(TAP) test/images.80.test.js
	$(NODE_EXEC) $(TAP) test/images.test.js

keys_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/keys.test.js

networks_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/networks.test.js

nics_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/nics.test.js

machines_all_test:
	$(NODE_EXEC) $(TAP) test/machines.test.js

machines_70_test:
	$(NODE_EXEC) $(TAP) test/machines.70.test.js

machines_71_test:
	$(NODE_EXEC) $(TAP) test/machines.71.test.js

machines_72_test:
	$(NODE_EXEC) $(TAP) test/machines.72.test.js

machines_73_test:
	$(NODE_EXEC) $(TAP) test/machines.73.test.js

machines_80_test:
	$(NODE_EXEC) $(TAP) test/machines.80.test.js

machines_test: machines_all_test machines_70_test machines_71_test machines_72_test machines_73_test machines_80_test

packages_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/packages.test.js

populate_network_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/populate_network.test.js

services_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/services.test.js

tests_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/tests.test.js

users_test: $(TAP)
	$(NODE_EXEC) $(TAP) test/users.test.js

test: auth_test account_test analytics_test datacenters_test datasets_test fabrics_test images_test keys_test networks_test packages_test populate_network_test services_test tests_test users_test nics_test machines_test

no_machines_test: auth_test account_test analytics_test datacenters_test datasets_test fabrics_test images_test keys_test networks_test packages_test populate_network_test services_test tests_test users_test

provision_limits_plugin_test:
	$(NODE_EXEC) $(TAP) test/provision_limits.test.javascript

plugins_test: provision_limits_plugin_test

include ./deps/eng/tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.targ
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.targ
endif
include ./deps/eng/tools/mk/Makefile.smf.targ
include ./deps/eng/tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
