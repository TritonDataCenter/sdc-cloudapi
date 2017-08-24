#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2017, Joyent, Inc.
#

#
# Makefile: CloudAPI, the public API for Triton
#

NAME :=			cloudapi

#
# Files
#

#
# Some Javascript files have been included from a third party project, and
# are not presently clean from a lint or style perspective.
#
UNWASHED_FILES =	$(wildcard lib/node-http-signature/*.js)

DOC_FILES =		index.md admin.md dev.md
RESTDOWN_FLAGS =	--brand-dir=deps/restdown-brand-remora
EXTRA_DOC_DEPS +=	deps/restdown-brand-remora/.git

JS_FILES :=		$(wildcard *.js) \
			$(shell find lib test bench plugins -name '*.js')
JSL_CONF_NODE =		tools/jsl.node.conf
JSL_FILES_NODE =	$(filter-out $(UNWASHED_FILES),$(JS_FILES))
JSSTYLE_FILES =		$(filter-out $(UNWASHED_FILES),$(JS_FILES))
JSSTYLE_FLAGS =		-f tools/jsstyle.conf

			#$(shell find lib -maxdepth 1 -name '*.js') \

SMF_MANIFESTS_IN =	smf/manifests/cloudapi.xml.in \
			smf/manifests/haproxy.xml.in \
			smf/manifests/stud.xml.in

#
# By default, we run all of the tests.  It is possible to select a different
# set of tests by setting TEST_LIST to a list of the test names to run; e.g.,
# if you wish to run only "test/machines.70.test.js" and "test/nics.test.js",
# invoke:
#
#     make test TEST_LIST='machines.70 nics'
#
TEST_LIST =		$(subst .test.js,,$(notdir $(wildcard test/*.test.js)))


NODE_PREBUILT_VERSION =	v4.6.1
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_IMAGE =	18b094b0-eb01-11e5-80c1-175dac7ddf02
	NODE_PREBUILT_TAG =	zone
	NODE_MAKEFILE_TYPE =	_prebuilt
else
	NODE_MAKEFILE_TYPE =
endif


include ./tools/mk/Makefile.defs
include ./tools/mk/Makefile.node$(NODE_MAKEFILE_TYPE).defs
include ./tools/mk/Makefile.node_modules.defs
include ./tools/mk/Makefile.smf.defs


#
# Mountain Gorilla Variables
#
ROOT :=			$(shell pwd)
RELEASE_TARBALL :=	$(NAME)-pkg-$(STAMP).tar.bz2
RELSTAGEDIR :=		/tmp/$(STAMP)

#
# Repo-specific targets
#
.PHONY: all
all: build sdc-scripts

.PHONY: build
build: $(SMF_MANIFESTS) $(STAMP_NODE_MODULES)

DOC_CLEAN_FILES = docs/{index,admin,dev}.{html,json} build/docs
.PHONY: clean-docs
clean-docs:
	-$(RMTREE) $(DOC_CLEAN_FILES)
clean:: clean-docs


.PHONY: release
release: check build docs
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)
	@mkdir -p $(RELSTAGEDIR)/site
	@touch $(RELSTAGEDIR)/site/.do-not-delete-me
	@mkdir -p $(RELSTAGEDIR)/root
	@mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/ssl
	cp -r \
	    $(ROOT)/bin \
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
	    $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/
	mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/boot
	cp -R $(ROOT)/deps/sdc-scripts/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	cp -R $(ROOT)/boot/* $(RELSTAGEDIR)/root/opt/smartdc/boot/
	mkdir -p $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/build
	cp -r \
	    $(TOP)/build/node \
	    $(TOP)/build/docs \
	    $(RELSTAGEDIR)/root/opt/smartdc/$(NAME)/build
	cd $(RELSTAGEDIR) && $(TAR) -jcf $(ROOT)/$(RELEASE_TARBALL) root site
	@rm -rf $(RELSTAGEDIR)


.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
		echo "error: 'BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(BITS_DIR)/$(NAME)
	cp $(ROOT)/$(RELEASE_TARBALL) $(BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)


.PHONY: test
test: $(TEST_LIST:%=run-test.%)

run-test.%: test/%.test.js $(STAMP_NODE_MODULES)
	$(NODE) ./node_modules/.bin/tape $<

include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.node$(NODE_MAKEFILE_TYPE).targ
include ./tools/mk/Makefile.node_modules.targ
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
